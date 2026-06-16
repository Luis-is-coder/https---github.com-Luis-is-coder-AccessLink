-- AccessLink Database Schema (PostgreSQL)
-- Run: npm run db:setup   (or psql -f database/schema.sql)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    role            VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'volunteer', 'venue_owner', 'admin')),
    disability_prefs JSONB DEFAULT '{"mobility":false,"vision":false,"hearing":false}'::jsonb,
    phone           VARCHAR(50),
    emergency_contact VARCHAR(255),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Locations (places on the map)
CREATE TABLE IF NOT EXISTS locations (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(255) NOT NULL,
    address             TEXT,
    lat                 DECIMAL(10, 8) NOT NULL,
    lng                 DECIMAL(11, 8) NOT NULL,
    category            VARCHAR(100) DEFAULT 'other',
    wheelchair_accessible BOOLEAN DEFAULT FALSE,
    elevator            BOOLEAN DEFAULT FALSE,
    braille_signage     BOOLEAN DEFAULT FALSE,
    quiet_room          BOOLEAN DEFAULT FALSE,
    sign_language       BOOLEAN DEFAULT FALSE,
    accessible_restroom BOOLEAN DEFAULT FALSE,
    description         TEXT,
    claimed_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    verified            BOOLEAN DEFAULT FALSE,
    created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Crowdsourced reports
CREATE TABLE IF NOT EXISTS reports (
    id              SERIAL PRIMARY KEY,
    location_id     INTEGER REFERENCES locations(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    description     TEXT NOT NULL,
    photo_path      VARCHAR(500),
    status          VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    tags            JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Volunteers (for emergency help)
CREATE TABLE IF NOT EXISTS volunteers (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    lat             DECIMAL(10, 8),
    lng             DECIMAL(11, 8),
    available       BOOLEAN DEFAULT TRUE,
    radius_km       DECIMAL(5, 2) DEFAULT 5.0,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Emergency / "I'm stuck" requests
CREATE TABLE IF NOT EXISTS emergency_requests (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    lat             DECIMAL(10, 8) NOT NULL,
    lng             DECIMAL(11, 8) NOT NULL,
    message         TEXT NOT NULL,
    needs           VARCHAR(255),
    status          VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'responded', 'resolved')),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Saved itineraries
CREATE TABLE IF NOT EXISTS itineraries (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(255) DEFAULT 'My Trip',
    start_lat       DECIMAL(10, 8) NOT NULL,
    start_lng       DECIMAL(11, 8) NOT NULL,
    end_lat         DECIMAL(10, 8) NOT NULL,
    end_lng         DECIMAL(11, 8) NOT NULL,
    waypoints       JSONB DEFAULT '[]'::jsonb,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_locations_coords ON locations (lat, lng);
CREATE INDEX IF NOT EXISTS idx_locations_category ON locations (category);
CREATE INDEX IF NOT EXISTS idx_reports_location ON reports (location_id);
CREATE INDEX IF NOT EXISTS idx_volunteers_available ON volunteers (available) WHERE available = TRUE;
CREATE INDEX IF NOT EXISTS idx_emergency_open ON emergency_requests (status) WHERE status = 'open';

-- Trigger to update locations.updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS locations_updated_at ON locations;
CREATE TRIGGER locations_updated_at
    BEFORE UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
