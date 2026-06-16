/**
 * Runs schema.sql and seeds demo users with real bcrypt hashes.
 * Usage: npm run db:setup
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, query } = require('../server/config/db');

async function setup() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: Set DATABASE_URL in your .env file first.');
    console.error('Copy .env.example to .env and fill in your PostgreSQL connection string.');
    process.exit(1);
  }

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  console.log('Running schema...');
  await pool.query(schema);
  console.log('Schema applied.');

  const hash = await bcrypt.hash('password123', 10);

  console.log('Seeding demo users...');
  await query(
    `INSERT INTO users (email, password_hash, name, role, disability_prefs, phone) VALUES
      ($1, $2, 'Demo User', 'user', '{"mobility":true,"vision":false,"hearing":false}', '+15551234567'),
      ($3, $2, 'Cafe Owner', 'venue_owner', '{"mobility":false,"vision":false,"hearing":false}', NULL),
      ($4, $2, 'Help Volunteer', 'volunteer', '{"mobility":false,"vision":false,"hearing":false}', '+15559876543')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    ['demo@accesslink.app', hash, 'owner@cafe.com', 'volunteer@accesslink.app']
  );

  const { rows: users } = await query('SELECT id, email FROM users WHERE email = $1', ['volunteer@accesslink.app']);
  if (users.length) {
    await query(
      `INSERT INTO volunteers (user_id, lat, lng, available, radius_km)
       VALUES ($1, 1.2900, 103.8500, TRUE, 10)
       ON CONFLICT (user_id) DO NOTHING`,
      [users[0].id]
    );
  }

  const { rows: locCount } = await query('SELECT COUNT(*)::int AS count FROM locations');
  if (locCount[0].count === 0) {
    console.log('Seeding sample locations...');
    await query(`
      INSERT INTO locations (name, address, lat, lng, category, wheelchair_accessible, elevator, braille_signage, quiet_room, sign_language, accessible_restroom, description, verified) VALUES
      ('Marina Bay Mall', '10 Bayfront Ave', 1.2834, 103.8607, 'mall', TRUE, TRUE, TRUE, FALSE, FALSE, TRUE, 'Fully accessible mall with ramps at all entrances.', TRUE),
      ('Green Leaf Cafe', '45 Orchard Road', 1.3048, 103.8318, 'cafe', TRUE, FALSE, FALSE, TRUE, FALSE, TRUE, 'Quiet corner available. Step-free entry.', TRUE),
      ('City General Hospital', '100 Hospital Drive', 1.2789, 103.8456, 'hospital', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, 'Full accessibility services including sign language interpreters.', TRUE),
      ('Riverside Park', 'Park Connector', 1.2900, 103.8500, 'park', TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, 'Paved paths throughout. Accessible restrooms near entrance.', FALSE),
      ('Central Library', '55 Library Lane', 1.2970, 103.8380, 'library', TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, 'Braille books section. Elevator to all floors.', TRUE),
      ('Metro Station Plaza', '200 Transit Way', 1.2750, 103.8550, 'transit', TRUE, TRUE, FALSE, FALSE, FALSE, TRUE, 'Elevator access to all platforms.', TRUE)
    `);
  }

  console.log('\nSetup complete!');
  console.log('Demo accounts (password: password123):');
  console.log('  demo@accesslink.app      – regular user');
  console.log('  owner@cafe.com           – venue owner');
  console.log('  volunteer@accesslink.app – volunteer');
  await pool.end();
}

setup().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
