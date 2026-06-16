const express = require('express');
const { query } = require('../config/db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreLocation(loc, prefs) {
  let score = 0;
  if (prefs.mobility && loc.wheelchair_accessible) score += 3;
  if (prefs.mobility && loc.elevator) score += 1;
  if (prefs.vision && loc.braille_signage) score += 3;
  if (prefs.hearing && loc.sign_language) score += 3;
  if (prefs.hearing && loc.quiet_room) score += 1;
  if (loc.accessible_restroom) score += 1;
  if (loc.verified) score += 1;
  return score;
}

router.post('/plan', authRequired, async (req, res) => {
  try {
    const { start_lat, start_lng, end_lat, end_lng, title, notes } = req.body;

    if ([start_lat, start_lng, end_lat, end_lng].some((v) => v == null)) {
      return res.status(400).json({ error: 'Start and end coordinates required' });
    }

    const { rows: userRows } = await query(
      'SELECT disability_prefs FROM users WHERE id = $1',
      [req.user.id]
    );
    const prefs = userRows[0]?.disability_prefs || {
      mobility: false,
      vision: false,
      hearing: false,
    };

    const midLat = (parseFloat(start_lat) + parseFloat(end_lat)) / 2;
    const midLng = (parseFloat(start_lng) + parseFloat(end_lng)) / 2;
    const routeDistance = haversineKm(
      parseFloat(start_lat),
      parseFloat(start_lng),
      parseFloat(end_lat),
      parseFloat(end_lng)
    );
    const searchRadius = Math.max(2, routeDistance / 2 + 1);

    const { rows: allLocs } = await query('SELECT * FROM locations');

    const waypoints = allLocs
      .map((loc) => {
        const distToRoute = Math.min(
          haversineKm(parseFloat(start_lat), parseFloat(start_lng), parseFloat(loc.lat), parseFloat(loc.lng)),
          haversineKm(parseFloat(end_lat), parseFloat(end_lng), parseFloat(loc.lat), parseFloat(loc.lng)),
          haversineKm(midLat, midLng, parseFloat(loc.lat), parseFloat(loc.lng))
        );
        return {
          ...loc,
          distance_km: distToRoute,
          accessibility_score: scoreLocation(loc, prefs),
        };
      })
      .filter((loc) => loc.distance_km <= searchRadius && loc.accessibility_score > 0)
      .sort((a, b) => b.accessibility_score - a.accessibility_score || a.distance_km - b.distance_km)
      .slice(0, 8);

    const { rows: saved } = await query(
      `INSERT INTO itineraries (user_id, title, start_lat, start_lng, end_lat, end_lng, waypoints, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        req.user.id,
        title || 'My Accessible Trip',
        start_lat,
        start_lng,
        end_lat,
        end_lng,
        JSON.stringify(waypoints),
        notes || null,
      ]
    );

    res.status(201).json({
      itinerary: saved[0],
      route: {
        start: { lat: parseFloat(start_lat), lng: parseFloat(start_lng) },
        end: { lat: parseFloat(end_lat), lng: parseFloat(end_lng) },
        distance_km: Math.round(routeDistance * 100) / 100,
      },
      suggested_stops: waypoints,
      preferences_used: prefs,
    });
  } catch (err) {
    console.error('Itinerary plan error:', err);
    res.status(500).json({ error: 'Failed to plan itinerary' });
  }
});

router.get('/', authRequired, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM itineraries WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Itineraries list error:', err);
    res.status(500).json({ error: 'Failed to fetch itineraries' });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM itineraries WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Itinerary not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Itinerary detail error:', err);
    res.status(500).json({ error: 'Failed to fetch itinerary' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM itineraries WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Itinerary not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete itinerary error:', err);
    res.status(500).json({ error: 'Failed to delete itinerary' });
  }
});

module.exports = router;
