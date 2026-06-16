'use strict';
/**
 * AccessLink — Singapore Data Import
 *
 * Sources:
 *   1. OpenStreetMap / Overpass API   — free, no key needed
 *   2. LTA DataMall                   — free, register at datamall.lta.gov.sg
 *      Set LTA_API_KEY in .env to enable bus stops + MRT stations.
 *   3. data.gov.sg                    — free, no key needed
 *      Hawker centres.
 *
 * Usage:
 *   node database/import-singapore.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SG       = '1.1304,103.6072,1.4748,104.0872';
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const LTA_BASE = 'https://datamall2.mytransport.sg/ltaodataservice';

// ─── Category mapping ──────────────────────────────────────────────────────
const CATEGORY_MAP = {
  hospital: 'hospital', clinic: 'hospital', dentist: 'hospital',
  doctors: 'hospital', pharmacy: 'hospital',
  library: 'library',
  school: 'education', university: 'education', college: 'education',
  kindergarten: 'education',
  community_centre: 'community', social_facility: 'community',
  place_of_worship: 'community',
  museum: 'culture', theatre: 'culture', cinema: 'culture',
  arts_centre: 'culture',
  bus_station: 'transit', station: 'transit', subway_entrance: 'transit',
  mall: 'mall', retail: 'mall',
  supermarket: 'supermarket', convenience: 'supermarket',
  hawker_centre: 'food', food_court: 'food', restaurant: 'food', cafe: 'food',
  park: 'park', garden: 'park',
  bank: 'services', atm: 'services', post_office: 'services',
  toilets: 'services',
  government: 'government',
  sports_centre: 'sports', stadium: 'sports', gym: 'sports',
  hotel: 'hotel',
};

function mapCategory(tags) {
  for (const key of ['amenity', 'shop', 'railway', 'leisure', 'tourism', 'building']) {
    const val = tags[key];
    if (val && CATEGORY_MAP[val]) return CATEGORY_MAP[val];
  }
  if (tags.railway) return 'transit';
  if (tags.shop)    return 'mall';
  if (tags.leisure) return 'sports';
  return 'other';
}

function mapAccessibility(tags) {
  const wc = tags.wheelchair;
  return {
    wheelchair_accessible: wc === 'yes' || wc === 'limited' || wc === 'designated',
    elevator:              tags.elevator === 'yes' || tags.lift === 'yes',
    braille_signage:       tags.tactile_paving === 'yes' || tags.braille === 'yes'
                        || tags['information:braille'] === 'yes',
    quiet_room:            tags.quiet_room === 'yes' || tags.sensory_room === 'yes',
    sign_language:         tags['communication:sign_language'] === 'yes',
    accessible_restroom:   tags['toilets:wheelchair'] === 'yes'
                        || (tags.amenity === 'toilets' && (wc === 'yes' || wc === 'limited')),
  };
}

function buildAddress(tags) {
  const parts = [];
  if (tags['addr:housenumber']) parts.push(tags['addr:housenumber']);
  if (tags['addr:street'])      parts.push(tags['addr:street']);
  if (tags['addr:postcode'])    parts.push(tags['addr:postcode']);
  return parts.length ? parts.join(', ') : null;
}

async function safeFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AccessLink/1.0', ...options.headers },
    signal: AbortSignal.timeout(120000),
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Dedup key: round to 4 decimal places (~11 m grid) ────────────────────
function dedupKey(name, lat, lng) {
  return `${name}|${Math.round(lat * 1e4)}|${Math.round(lng * 1e4)}`;
}

// ─── Bulk insert helper ─────────────────────────────────────────────────────
// Strategy:
//   1. Load all existing (name, lat, lng) into a JS Set — one query.
//   2. Filter incoming rows against the Set in JS — no per-row SELECT.
//   3. Insert new rows in chunks of 200 per transaction.
async function bulkInsert(rows, source, existingKeys) {
  const newRows = rows.filter((r) => {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lng);
    if (!r.name || isNaN(lat) || isNaN(lng)) return false;
    return !existingKeys.has(dedupKey(r.name, lat, lng));
  });

  if (!newRows.length) {
    console.log(`  [${source}] 0 new rows (all already in DB)`);
    return 0;
  }

  const CHUNK = 200;
  let count   = 0;

  for (let i = 0; i < newRows.length; i += CHUNK) {
    const chunk  = newRows.slice(i, i + CHUNK);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of chunk) {
        const lat = parseFloat(row.lat);
        const lng = parseFloat(row.lng);
        await client.query(
          `INSERT INTO locations
             (name, address, lat, lng, category, description,
              wheelchair_accessible, elevator, braille_signage,
              quiet_room, sign_language, accessible_restroom, verified)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false)`,
          [
            row.name.slice(0, 255),
            row.address  || null,
            lat.toFixed(8),
            lng.toFixed(8),
            row.category || 'other',
            row.description ? row.description.slice(0, 500) : null,
            row.wheelchair_accessible || false,
            row.elevator              || false,
            row.braille_signage       || false,
            row.quiet_room            || false,
            row.sign_language         || false,
            row.accessible_restroom   || false,
          ]
        );
        count++;
        existingKeys.add(dedupKey(row.name, lat, lng));
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  [${source}] chunk ${i}–${i + CHUNK} failed: ${err.message}`);
    } finally {
      client.release();
    }
    process.stdout.write(`\r  ${source}: ${count}/${newRows.length} inserted...`);
  }
  process.stdout.write('\n');
  return count;
}

// ─── Load existing locations into a Set ───────────────────────────────────
async function loadExistingKeys() {
  const { rows } = await pool.query(
    'SELECT name, lat::float AS lat, lng::float AS lng FROM locations'
  );
  const set = new Set();
  for (const r of rows) set.add(dedupKey(r.name, r.lat, r.lng));
  console.log(`  Loaded ${set.size} existing location keys for dedup`);
  return set;
}

// ─── 1. Overpass / OpenStreetMap ──────────────────────────────────────────
async function importOSM(existingKeys) {
  console.log('\n── 1. OpenStreetMap (Overpass API) ─────────────────────────');
  console.log('  Querying... this takes 30–60 s');

  const query = `
[out:json][timeout:90][maxsize:67108864];
(
  node["wheelchair"~"^(yes|limited|designated)$"](${SG});
  way["wheelchair"~"^(yes|limited|designated)$"](${SG});

  node["amenity"~"^(hospital|clinic|dentist|pharmacy|library|community_centre|social_facility|place_of_worship|museum|theatre|cinema|arts_centre|bus_station|bank|post_office|toilets|sports_centre|food_court|hawker_centre|school|university|college|kindergarten|government)$"](${SG});
  way["amenity"~"^(hospital|clinic|library|community_centre|museum|theatre|cinema|sports_centre|school|university|college)$"](${SG});

  node["railway"~"^(station|subway_entrance)$"](${SG});
  way["railway"="station"](${SG});

  node["shop"~"^(mall|supermarket|department_store)$"](${SG});
  way["shop"~"^(mall|supermarket|department_store)$"](${SG});
  way["building"~"^(mall|retail|shopping_centre|hospital|library|school|university|stadium|sports_centre|government)$"](${SG});

  node["leisure"~"^(sports_centre|stadium|park|garden)$"](${SG});
  way["leisure"~"^(sports_centre|stadium|park|garden)$"](${SG});

  node["tourism"~"^(hotel|museum|gallery|attraction)$"](${SG});
  way["tourism"~"^(hotel|museum|attraction)$"](${SG});
);
out body center 10000;
  `.trim();

  let data;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`  Trying ${endpoint} ...`);
      const res = await fetch(endpoint, {
        method:  'POST',
        body:    `data=${encodeURIComponent(query)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'AccessLink/1.0',
        },
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) { console.warn(`  → HTTP ${res.status}, trying next...`); continue; }
      const text = await res.text();
      if (text.trim().startsWith('<')) { console.warn('  → Got XML (rate limited), trying next...'); continue; }
      data = JSON.parse(text);
      console.log(`  → OK from ${endpoint}`);
      break;
    } catch (err) {
      console.warn(`  → ${err.message}, trying next...`);
    }
  }
  if (!data) {
    console.error('  All Overpass endpoints failed. OSM import skipped.');
    return 0;
  }

  const elements = data.elements || [];
  console.log(`  Received ${elements.length} OSM elements`);

  const rows = [];
  for (const el of elements) {
    if (!el.tags?.name) continue;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!lat || !lng) continue;

    rows.push({
      name:        el.tags.name,
      address:     buildAddress(el.tags),
      lat:         parseFloat(lat).toFixed(8),
      lng:         parseFloat(lng).toFixed(8),
      category:    mapCategory(el.tags),
      description: el.tags.description || el.tags.note || null,
      ...mapAccessibility(el.tags),
    });
  }

  console.log(`  Mapped ${rows.length} named locations`);
  const n = await bulkInsert(rows, 'OSM', existingKeys);
  console.log(`  Inserted ${n} OSM locations`);
  return n;
}

// ─── 2a. LTA DataMall — Bus Stops ─────────────────────────────────────────
async function importLTABusStops(existingKeys) {
  if (!process.env.LTA_API_KEY) {
    console.log('\n── 2a. LTA Bus Stops — SKIPPED (set LTA_API_KEY in .env)');
    return 0;
  }
  console.log('\n── 2a. LTA DataMall — Bus Stops ────────────────────────────');

  const rows = [];
  let skip   = 0;
  while (true) {
    let data;
    try {
      data = await safeFetch(`${LTA_BASE}/BusStops?$skip=${skip}`, {
        headers: { AccountKey: process.env.LTA_API_KEY, accept: 'application/json' },
      });
    } catch (err) {
      if (err.message.includes('401')) {
        console.error('  LTA key rejected (HTTP 401).');
        console.error('  The "Extended OBU Library SDK" key is for a different LTA service.');
        console.error('  For bus stop data, register the DataMall REST API (not the OBU SDK) at:');
        console.error('  https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html');
      } else {
        console.error(`  LTA bus stops failed: ${err.message}`);
      }
      break;
    }
    const batch = data.value || [];
    if (!batch.length) break;
    for (const s of batch) {
      if (!s.Latitude || !s.Longitude) continue;
      rows.push({
        name:                 (s.Description || `Bus Stop ${s.BusStopCode}`).slice(0, 255),
        address:              s.RoadName || null,
        lat:                  parseFloat(s.Latitude).toFixed(8),
        lng:                  parseFloat(s.Longitude).toFixed(8),
        category:             'transit',
        description:          `Bus stop ${s.BusStopCode}`,
        wheelchair_accessible: false,
        elevator:              false,
        braille_signage:       false,
        quiet_room:            false,
        sign_language:         false,
        accessible_restroom:   false,
      });
    }
    skip += batch.length;
    process.stdout.write(`\r  Fetched ${rows.length} bus stops from LTA...`);
    if (batch.length < 500) break;
    await sleep(300);
  }
  process.stdout.write('\n');
  const n = await bulkInsert(rows, 'LTA Bus Stop', existingKeys);
  console.log(`  Inserted ${n} bus stops`);
  return n;
}

// ─── 2b. LTA DataMall — Train Stations ────────────────────────────────────
async function importLTATrainStations(existingKeys) {
  if (!process.env.LTA_API_KEY) {
    console.log('\n── 2b. LTA Train Stations — SKIPPED (set LTA_API_KEY in .env)');
    return 0;
  }
  console.log('\n── 2b. LTA DataMall — Train Stations ──────────────────────');

  let data;
  try {
    data = await safeFetch(`${LTA_BASE}/TrainStations`, {
      headers: { AccountKey: process.env.LTA_API_KEY, accept: 'application/json' },
    });
  } catch (err) {
    console.error(`  LTA train fetch failed: ${err.message}`);
    return 0;
  }

  const stations = data.value || [];
  console.log(`  Fetched ${stations.length} train stations from LTA`);

  const rows = stations
    .filter((s) => s.Latitude && s.Longitude)
    .map((s) => ({
      name:                 (s.StationName || s.TyeName || 'MRT Station').slice(0, 255),
      address:              null,
      lat:                  parseFloat(s.Latitude).toFixed(8),
      lng:                  parseFloat(s.Longitude).toFixed(8),
      category:             'transit',
      description:          `${s.TrainType || 'MRT'} station`,
      wheelchair_accessible: true,
      elevator:              true,
      braille_signage:       true,
      quiet_room:            false,
      sign_language:         false,
      accessible_restroom:   true,
    }));

  const n = await bulkInsert(rows, 'LTA Train', existingKeys);
  console.log(`  Inserted ${n} train stations`);
  return n;
}

// ─── 3. data.gov.sg — Hawker Centres ──────────────────────────────────────
// The dataset API (CKAN) is at data.gov.sg/api/action/datastore_search.
// Field names vary by dataset version — we try common variants.
async function importHawkerCentres(existingKeys) {
  console.log('\n── 3. data.gov.sg — Hawker Centres ────────────────────────');

  // Try multiple known resource IDs for this dataset
  const RESOURCE_IDS = [
    'b80cb643-a732-480d-86b5-e03957bc82aa',  // v1
    '1c80f84c-6e04-4f73-b9e6-f96e6b473a72',  // v2
  ];

  let records = [];
  for (const rid of RESOURCE_IDS) {
    try {
      const url  = `https://data.gov.sg/api/action/datastore_search?resource_id=${rid}&limit=500`;
      const data = await safeFetch(url);
      records    = data.result?.records || [];
      if (records.length) {
        console.log(`  Fetched ${records.length} hawker centres (resource ${rid})`);
        // Print field names of first record so we can verify
        if (records[0]) {
          console.log(`  Fields: ${Object.keys(records[0]).join(', ')}`);
        }
        break;
      }
    } catch (err) {
      console.warn(`  Resource ${rid} failed: ${err.message}`);
    }
  }

  if (!records.length) {
    console.warn('  No hawker centre records found — skipping');
    return 0;
  }

  // Detect lat/lng field names dynamically
  const sample = records[0];
  const allKeys = Object.keys(sample).map((k) => k.toLowerCase());

  const latKey = Object.keys(sample).find((k) =>
    ['latitude_hc', 'latitude', 'lat', 'lat_x'].includes(k.toLowerCase())
  );
  const lngKey = Object.keys(sample).find((k) =>
    ['longitude_hc', 'longitude', 'lng', 'long', 'long_y', 'lon'].includes(k.toLowerCase())
  );
  const nameKey = Object.keys(sample).find((k) =>
    ['name_of_centre', 'name', 'centre_name', 'hawker_centre_name'].includes(k.toLowerCase())
  );
  const addrKey = Object.keys(sample).find((k) =>
    ['address_myenv', 'address', 'addr'].includes(k.toLowerCase())
  );

  console.log(`  Using fields → name:${nameKey} lat:${latKey} lng:${lngKey}`);

  if (!latKey || !lngKey) {
    console.warn('  Cannot find lat/lng fields — skipping. Available:', Object.keys(sample).join(', '));
    return 0;
  }

  const rows = records
    .filter((r) => r[latKey] && r[lngKey] && !isNaN(parseFloat(r[latKey])))
    .map((r) => ({
      name:                 ((nameKey && r[nameKey]) || 'Hawker Centre').slice(0, 255),
      address:              (addrKey && r[addrKey]) || null,
      lat:                  parseFloat(r[latKey]).toFixed(8),
      lng:                  parseFloat(r[lngKey]).toFixed(8),
      category:             'food',
      description:          r.no_of_stalls ? `Hawker centre — ${r.no_of_stalls} stalls` : 'Hawker centre',
      wheelchair_accessible: true,
      elevator:              false,
      braille_signage:       false,
      quiet_room:            false,
      sign_language:         false,
      accessible_restroom:   true,
    }));

  const n = await bulkInsert(rows, 'Hawker Centre', existingKeys);
  console.log(`  Inserted ${n} hawker centres`);
  return n;
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  AccessLink — Singapore Data Import');
  console.log('═══════════════════════════════════════════════════');

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL not set in .env');
    process.exit(1);
  }

  const { rows: before } = await pool.query('SELECT COUNT(*) FROM locations');
  console.log(`\nCurrent locations in DB: ${before[0].count}`);

  // Load existing keys once — shared across all importers
  const existingKeys = await loadExistingKeys();

  let total = 0;
  try { total += await importOSM(existingKeys);               } catch (e) { console.error('OSM error:', e.message); }
  try { total += await importLTABusStops(existingKeys);       } catch (e) { console.error('LTA bus error:', e.message); }
  try { total += await importLTATrainStations(existingKeys);  } catch (e) { console.error('LTA train error:', e.message); }
  try { total += await importHawkerCentres(existingKeys);     } catch (e) { console.error('Hawker error:', e.message); }

  const { rows: after } = await pool.query('SELECT COUNT(*) FROM locations');

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  Import complete`);
  console.log(`  New rows inserted : ${total}`);
  console.log(`  Total in DB now   : ${after[0].count}`);
  console.log('═══════════════════════════════════════════════════\n');

  await pool.end();
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
