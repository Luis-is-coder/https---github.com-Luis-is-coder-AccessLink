-- Sample data for demo / hackathon presentation
-- Password for all demo users: password123

INSERT INTO users (email, password_hash, name, role, disability_prefs, phone) VALUES
('demo@accesslink.app', '$2a$10$8K1p/a0dL1LXMIgoEDFrwOfMQW5KZqYqJ8qJ8qJ8qJ8qJ8qJ8qJ8q', 'Demo User', 'user', '{"mobility":true,"vision":false,"hearing":false}', '+15551234567'),
('owner@cafe.com', '$2a$10$8K1p/a0dL1LXMIgoEDFrwOfMQW5KZqJ8qJ8qJ8qJ8qJ8qJ8qJ8qJ8q', 'Cafe Owner', 'venue_owner', '{"mobility":false,"vision":false,"hearing":false}', NULL),
('volunteer@accesslink.app', '$2a$10$8K1p/a0dL1LXMIgoEDFrwOfMQW5KZqJ8qJ8qJ8qJ8qJ8qJ8qJ8qJ8q', 'Help Volunteer', 'volunteer', '{"mobility":false,"vision":false,"hearing":false}', '+15559876543')
ON CONFLICT (email) DO NOTHING;

-- Note: password hashes above are placeholders. setup.js generates real hashes.

-- Sample locations (Singapore area – change coords to your city)
INSERT INTO locations (name, address, lat, lng, category, wheelchair_accessible, elevator, braille_signage, quiet_room, sign_language, accessible_restroom, description, verified) VALUES
('Marina Bay Mall', '10 Bayfront Ave', 1.2834, 103.8607, 'mall', TRUE, TRUE, TRUE, FALSE, FALSE, TRUE, 'Fully accessible mall with ramps at all entrances.', TRUE),
('Green Leaf Cafe', '45 Orchard Road', 1.3048, 103.8318, 'cafe', TRUE, FALSE, FALSE, TRUE, FALSE, TRUE, 'Quiet corner available. Step-free entry.', TRUE),
('City General Hospital', '100 Hospital Drive', 1.2789, 103.8456, 'hospital', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, 'Full accessibility services including sign language interpreters.', TRUE),
('Riverside Park', 'Park Connector', 1.2900, 103.8500, 'park', TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, 'Paved paths throughout. Accessible restrooms near entrance.', FALSE),
('Central Library', '55 Library Lane', 1.2970, 103.8380, 'library', TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, 'Braille books section. Elevator to all floors.', TRUE),
('Metro Station Plaza', '200 Transit Way', 1.2750, 103.8550, 'transit', TRUE, TRUE, FALSE, FALSE, FALSE, TRUE, 'Elevator access to all platforms.', TRUE)
ON CONFLICT DO NOTHING;
