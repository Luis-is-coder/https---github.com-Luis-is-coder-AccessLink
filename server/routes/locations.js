const express = require('express');
const { query } = require('../config/db');
const { authRequired, optionalAuth } = require('../middleware/auth');

const router = express.Router();

function buildFilterQuery(filters) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (filters.mobility === 'true') {
    conditions.push('wheelchair_accessible = TRUE');
  }
  if (filters.vision === 'true') {
    conditions.push('(braille_signage = TRUE OR description ILIKE \'%braille%\')');
  }
  if (filters.hearing === 'true') {
    conditions.push('(sign_language = TRUE OR quiet_room = TRUE)');
  }
  if (filters.category) {
    conditions.push(`category = $${idx++}`);
    params.push(filters.category);
  }
  if (filters.search) {
    conditions.push(`(name ILIKE $${idx} OR address ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

router.get('/', async (req, res) => {
  try {
    const { where, params } = buildFilterQuery(req.query);
    const { rows } = await query(
      `SELECT id, name, address, lat, lng, category,
              wheelchair_accessible, elevator, braille_signage,
              quiet_room, sign_language, accessible_restroom,
              description, verified, claimed_by, created_at
       FROM locations ${where}
       ORDER BY name`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('Locations list error:', err);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

router.get('/nearby/search', async (req, res) => {
  try {
    const { lat, lng, radius = 2 } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng required' });
    }

    const { rows } = await query(
      `SELECT * FROM (
        SELECT *, (
          6371 * acos(
            LEAST(1, GREATEST(-1,
              cos(radians($1)) * cos(radians(lat::float)) * cos(radians(lng::float) - radians($2))
              + sin(radians($1)) * sin(radians(lat::float))
            ))
          )
        ) AS distance_km
        FROM locations
      ) sub
      WHERE distance_km <= $3
      ORDER BY distance_km`,
      [parseFloat(lat), parseFloat(lng), parseFloat(radius)]
    );
    res.json(rows);
  } catch (err) {
    console.error('Nearby search error:', err);
    res.status(500).json({ error: 'Failed to search nearby locations' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT l.*, u.name AS owner_name
       FROM locations l
       LEFT JOIN users u ON u.id = l.claimed_by
       WHERE l.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Location not found' });

    const { rows: reports } = await query(
      `SELECT r.id, r.description, r.photo_path, r.status, r.created_at, u.name AS reporter_name
       FROM reports r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.location_id = $1
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [req.params.id]
    );

    res.json({ ...rows[0], reports });
  } catch (err) {
    console.error('Location detail error:', err);
    res.status(500).json({ error: 'Failed to fetch location' });
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    const {
      name, address, lat, lng, category,
      wheelchair_accessible, elevator, braille_signage,
      quiet_room, sign_language, accessible_restroom, description,
    } = req.body;

    if (!name || lat == null || lng == null) {
      return res.status(400).json({ error: 'Name, latitude, and longitude are required' });
    }

    const { rows } = await query(
      `INSERT INTO locations (
        name, address, lat, lng, category,
        wheelchair_accessible, elevator, braille_signage,
        quiet_room, sign_language, accessible_restroom,
        description, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [
        name, address || null, lat, lng, category || 'other',
        !!wheelchair_accessible, !!elevator, !!braille_signage,
        !!quiet_room, !!sign_language, !!accessible_restroom,
        description || null, req.user.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create location error:', err);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

router.put('/:id', authRequired, async (req, res) => {
  try {
    const { rows: existing } = await query('SELECT * FROM locations WHERE id = $1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Location not found' });

    const loc = existing[0];
    if (loc.claimed_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only edit locations you have claimed' });
    }

    const fields = [
      'name', 'address', 'category', 'wheelchair_accessible', 'elevator',
      'braille_signage', 'quiet_room', 'sign_language', 'accessible_restroom', 'description',
    ];
    const updates = [];
    const params = [];
    let idx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        params.push(req.body[field]);
      }
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE locations SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Update location error:', err);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

router.post('/:id/claim', authRequired, async (req, res) => {
  try {
    if (!['venue_owner', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only venue owners can claim locations' });
    }

    const { rows } = await query(
      `UPDATE locations SET claimed_by = $1 WHERE id = $2 AND claimed_by IS NULL RETURNING *`,
      [req.user.id, req.params.id]
    );

    if (!rows.length) {
      const { rows: check } = await query('SELECT claimed_by FROM locations WHERE id = $1', [req.params.id]);
      if (!check.length) return res.status(404).json({ error: 'Location not found' });
      return res.status(409).json({ error: 'Location already claimed' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Claim location error:', err);
    res.status(500).json({ error: 'Failed to claim location' });
  }
});

module.exports = router;
