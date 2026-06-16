require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const locationRoutes = require('./routes/locations');
const reportRoutes = require('./routes/reports');
const itineraryRoutes = require('./routes/itinerary');
const emergencyRoutes = require('./routes/emergency');
const venueRoutes = require('./routes/venues');
const routingRoutes = require('./routes/routing');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/auth', authRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/itinerary', itineraryRoutes);
app.use('/api/emergency', emergencyRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/routing', routingRoutes);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    app: 'AccessLink',
    database: process.env.DATABASE_URL ? 'configured' : 'missing DATABASE_URL',
  });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`AccessLink running at http://localhost:${PORT}`);
  if (!process.env.DATABASE_URL) {
    console.warn('WARNING: DATABASE_URL not set. Copy .env.example to .env and configure PostgreSQL.');
  }
});
