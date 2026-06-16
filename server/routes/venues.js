const express = require('express');
const { query } = require('../config/db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/my-locations', authRequired, requireRole('venue_owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT l.*, (
        SELECT COUNT(*)::int FROM reports r WHERE r.location_id = l.id AND r.status = 'pending'
      ) AS pending_reports
      FROM locations l
      WHERE l.claimed_by = $1 OR ($2 = 'admin')
      ORDER BY l.name`,
      [req.user.id, req.user.role]
    );
    res.json(rows);
  } catch (err) {
    console.error('My locations error:', err);
    res.status(500).json({ error: 'Failed to fetch venues' });
  }
});

router.get('/unclaimed', authRequired, requireRole('venue_owner', 'admin'), async (_req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, name, address, category FROM locations WHERE claimed_by IS NULL ORDER BY name LIMIT 100'
    );
    res.json(rows);
  } catch (err) {
    console.error('Unclaimed locations error:', err);
    res.status(500).json({ error: 'Failed to fetch unclaimed locations' });
  }
});

router.get('/stats', authRequired, requireRole('venue_owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
        COUNT(DISTINCT l.id)::int AS total_locations,
        COUNT(DISTINCT r.id)::int AS total_reports,
        COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'pending')::int AS pending_reports
       FROM locations l
       LEFT JOIN reports r ON r.location_id = l.id
       WHERE l.claimed_by = $1 OR ($2 = 'admin')`,
      [req.user.id, req.user.role]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Venue stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
