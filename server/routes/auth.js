const bcrypt = require('bcryptjs');
const express = require('express');
const { query } = require('../config/db');
const { signToken, authRequired } = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password, name, phone, disability_prefs, role } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const allowedRoles = ['user', 'volunteer', 'venue_owner'];
    const userRole = allowedRoles.includes(role) ? role : 'user';

    const hash = await bcrypt.hash(password, 10);
    const prefs = disability_prefs || { mobility: false, vision: false, hearing: false };

    const { rows } = await query(
      `INSERT INTO users (email, password_hash, name, role, disability_prefs, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, name, role, disability_prefs, phone, created_at`,
      [email.toLowerCase(), hash, name, userRole, JSON.stringify(prefs), phone || null]
    );

    const user = rows[0];
    if (userRole === 'volunteer') {
      await query('INSERT INTO volunteers (user_id, available) VALUES ($1, TRUE) ON CONFLICT DO NOTHING', [user.id]);
    }

    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { rows } = await query(
      'SELECT id, email, name, role, disability_prefs, phone, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    delete user.password_hash;
    const token = signToken(user);
    res.json({ token, user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, email, name, role, disability_prefs, phone, emergency_contact, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.put('/profile', authRequired, async (req, res) => {
  try {
    const { name, phone, disability_prefs, emergency_contact } = req.body;
    const { rows } = await query(
      `UPDATE users SET
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        disability_prefs = COALESCE($3, disability_prefs),
        emergency_contact = COALESCE($4, emergency_contact)
       WHERE id = $5
       RETURNING id, email, name, role, disability_prefs, phone, emergency_contact`,
      [
        name || null,
        phone || null,
        disability_prefs ? JSON.stringify(disability_prefs) : null,
        emergency_contact || null,
        req.user.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.get('/leaderboard', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT u.id, u.name, COUNT(r.id)::int AS report_count
      FROM users u
      JOIN reports r ON r.user_id = u.id
      GROUP BY u.id, u.name
      ORDER BY report_count DESC
      LIMIT 10
    `);
    res.json(rows);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;
