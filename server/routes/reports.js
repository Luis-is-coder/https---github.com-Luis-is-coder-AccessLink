const path = require('path');
const express = require('express');
const multer = require('multer');
const { query } = require('../config/db');
const { authRequired, optionalAuth } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../public/uploads')),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype.split('/')[1]);
    cb(null, ext && mime);
  },
});

router.get('/', async (req, res) => {
  try {
    const { status, location_id } = req.query;
    let sql = `
      SELECT r.*, l.name AS location_name, u.name AS reporter_name
      FROM reports r
      LEFT JOIN locations l ON l.id = r.location_id
      LEFT JOIN users u ON u.id = r.user_id
      WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (status) {
      sql += ` AND r.status = $${idx++}`;
      params.push(status);
    }
    if (location_id) {
      sql += ` AND r.location_id = $${idx++}`;
      params.push(location_id);
    }

    sql += ' ORDER BY r.created_at DESC LIMIT 50';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Reports list error:', err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

router.post('/', optionalAuth, upload.single('photo'), async (req, res) => {
  try {
    const { location_id, description, tags } = req.body;
    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const photo_path = req.file ? `/uploads/${req.file.filename}` : null;
    const userId = req.user ? req.user.id : null;
    let locId = location_id || null;

    if (!locId && req.body.lat && req.body.lng && req.body.place_name) {
      const { rows: newLoc } = await query(
        `INSERT INTO locations (name, lat, lng, address, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [req.body.place_name, req.body.lat, req.body.lng, req.body.address || null, userId]
      );
      locId = newLoc[0].id;
    }

    if (!locId) {
      return res.status(400).json({ error: 'location_id or place coordinates required' });
    }

    const { rows } = await query(
      `INSERT INTO reports (location_id, user_id, description, photo_path, tags)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [locId, userId, description, photo_path, tags ? (typeof tags === 'string' ? tags : JSON.stringify(tags)) : '{}']
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create report error:', err);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

router.patch('/:id/status', authRequired, async (req, res) => {
  try {
    if (!['admin', 'venue_owner'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const { rows } = await query(
      'UPDATE reports SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Update report status error:', err);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

module.exports = router;
