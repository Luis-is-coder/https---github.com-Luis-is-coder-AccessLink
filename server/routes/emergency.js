const express = require('express');
const { query } = require('../config/db');
const { authRequired, optionalAuth } = require('../middleware/auth');
const { sendEmergencyEmail } = require('../services/email');
const { sendEmergencySMS } = require('../services/sms');

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

router.post('/help', optionalAuth, async (req, res) => {
  try {
    const { lat, lng, message, needs } = req.body;
    if (!lat || !lng || !message) {
      return res.status(400).json({ error: 'Location and message are required' });
    }

    const userId = req.user ? req.user.id : null;
    let userInfo = null;

    if (userId) {
      const { rows } = await query(
        'SELECT name, email, phone, emergency_contact FROM users WHERE id = $1',
        [userId]
      );
      userInfo = rows[0];
    }

    const { rows: request } = await query(
      `INSERT INTO emergency_requests (user_id, lat, lng, message, needs)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, lat, lng, message, needs || null]
    );

    const { rows: volunteers } = await query(`
      SELECT v.*, u.name, u.email, u.phone
      FROM volunteers v
      JOIN users u ON u.id = v.user_id
      WHERE v.available = TRUE AND v.lat IS NOT NULL AND v.lng IS NOT NULL
    `);

    const nearby = volunteers
      .map((v) => ({
        ...v,
        distance_km: haversineKm(parseFloat(lat), parseFloat(lng), parseFloat(v.lat), parseFloat(v.lng)),
      }))
      .filter((v) => v.distance_km <= (parseFloat(v.radius_km) || 5))
      .sort((a, b) => a.distance_km - b.distance_km);

    const alertPayload = {
      requestId: request[0].id,
      lat,
      lng,
      message,
      needs,
      userName: userInfo?.name || 'Anonymous user',
      userPhone: userInfo?.phone,
      mapsUrl: `https://www.google.com/maps?q=${lat},${lng}`,
    };

    const notifications = [];

    for (const vol of nearby.slice(0, 5)) {
      if (vol.email) {
        const sent = await sendEmergencyEmail(vol.email, vol.name, alertPayload);
        notifications.push({ volunteer: vol.name, email: sent });
      }
      if (vol.phone) {
        const sent = await sendEmergencySMS(vol.phone, alertPayload);
        notifications.push({ volunteer: vol.name, sms: sent });
      }
    }

    if (userInfo?.emergency_contact) {
      await sendEmergencyEmail(userInfo.emergency_contact, 'Emergency Contact', alertPayload);
      notifications.push({ emergency_contact: true });
    }

    res.status(201).json({
      request: request[0],
      volunteers_notified: nearby.length,
      notifications,
      message: nearby.length
        ? `Help request sent to ${nearby.length} nearby volunteer(s)`
        : 'Request saved. No volunteers nearby – consider calling local emergency services.',
    });
  } catch (err) {
    console.error('Emergency help error:', err);
    res.status(500).json({ error: 'Failed to send help request' });
  }
});

router.get('/requests', authRequired, async (req, res) => {
  try {
    if (!['admin', 'volunteer'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { rows } = await query(
      `SELECT e.*, u.name AS user_name, u.phone AS user_phone
       FROM emergency_requests e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.status = 'open'
       ORDER BY e.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Emergency requests error:', err);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

router.patch('/requests/:id', authRequired, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['open', 'responded', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const { rows } = await query(
      'UPDATE emergency_requests SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Request not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Update emergency error:', err);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

router.put('/volunteer/location', authRequired, async (req, res) => {
  try {
    const { lat, lng, available, radius_km } = req.body;
    await query(
      `INSERT INTO volunteers (user_id, lat, lng, available, radius_km, updated_at)
       VALUES ($1, $2, $3, COALESCE($4, TRUE), COALESCE($5, 5), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         lat = COALESCE($2, volunteers.lat),
         lng = COALESCE($3, volunteers.lng),
         available = COALESCE($4, volunteers.available),
         radius_km = COALESCE($5, volunteers.radius_km),
         updated_at = NOW()`,
      [req.user.id, lat, lng, available, radius_km]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Volunteer location error:', err);
    res.status(500).json({ error: 'Failed to update volunteer status' });
  }
});

module.exports = router;
