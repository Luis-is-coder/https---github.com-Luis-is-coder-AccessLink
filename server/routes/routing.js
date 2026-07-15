'use strict';

const express = require('express');
const { authRequired } = require('../middleware/auth');
const { query: dbQuery } = require('../config/db');

const router = express.Router();

const OSRM = 'https://router.project-osrm.org/route/v1';
// Multiple Overpass endpoints — tried in order if one fails/rate-limits
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const ORS_BASE = 'https://api.openrouteservice.org/v2/directions';

// ─── Fetch helper with timeout ────────────────────────────────────────────────
async function safeFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AccessLink/1.0', ...options.headers },
    signal: AbortSignal.timeout(9000),
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── GET /api/routing/plan ────────────────────────────────────────────────────
// Returns real walking + driving routes (OSRM), optionally wheelchair (ORS) and
// transit (OneMap Singapore), plus accessible OSM nodes from Overpass.
router.get('/plan', async (req, res) => {
  const { start_lat, start_lng, end_lat, end_lng } = req.query;
  if (!start_lat || !start_lng || !end_lat || !end_lng) {
    return res.status(400).json({ error: 'start_lat, start_lng, end_lat, end_lng are required' });
  }

  const slat = parseFloat(start_lat);
  const slng = parseFloat(start_lng);
  const elat = parseFloat(end_lat);
  const elng = parseFloat(end_lng);

  const routes = {};

  // ── Walking route (OSRM foot) ─────────────────────────────────────────────
  try {
    const data = await safeFetch(
      `${OSRM}/foot/${slng},${slat};${elng},${elat}?steps=true&geometries=geojson&overview=full`
    );
    if (data.code === 'Ok' && data.routes.length) {
      const r = data.routes[0];
      routes.walk = {
        mode: 'walk',
        label: 'Walking',
        color: '#2563eb',
        geometry: r.geometry,
        distance_m: Math.round(r.distance),
        duration_s: Math.round(r.duration),
        steps: extractOSRMSteps(r.legs, 'walk'),
      };
    }
  } catch (err) {
    console.warn('[Routing] Walk OSRM failed:', err.message);
  }

  // ── Driving/Taxi route (OSRM driving) ─────────────────────────────────────
  try {
    const data = await safeFetch(
      `${OSRM}/driving/${slng},${slat};${elng},${elat}?steps=true&geometries=geojson&overview=full`
    );
    if (data.code === 'Ok' && data.routes.length) {
      const r = data.routes[0];
      routes.drive = {
        mode: 'drive',
        label: 'Drive / Taxi',
        color: '#dc2626',
        geometry: r.geometry,
        distance_m: Math.round(r.distance),
        duration_s: Math.round(r.duration),
        steps: extractOSRMSteps(r.legs, 'drive'),
      };
    }
  } catch (err) {
    console.warn('[Routing] Drive OSRM failed:', err.message);
  }

  // ── Wheelchair route (OpenRouteService, needs ORS_API_KEY env var) ─────────
  if (process.env.ORS_API_KEY) {
    try {
      const data = await safeFetch(`${ORS_BASE}/wheelchair/geojson`, {
        method: 'POST',
        headers: {
          Authorization: process.env.ORS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordinates: [[slng, slat], [elng, elat]],
          instructions: true,
        }),
      });
      if (data.features?.length) {
        const feat = data.features[0];
        const summary = feat.properties.summary;
        routes.wheelchair = {
          mode: 'wheelchair',
          label: 'Wheelchair',
          color: '#059669',
          geometry: feat.geometry,
          distance_m: Math.round(summary.distance),
          duration_s: Math.round(summary.duration),
          steps: extractORSSteps(feat.properties.segments),
        };
      }
    } catch (err) {
      console.warn('[Routing] ORS wheelchair failed:', err.message);
    }
  }

  // ── Public transport (OneMap Singapore, needs ONEMAP_TOKEN env var) ────────
  if (process.env.ONEMAP_TOKEN) {
    try {
      const now  = new Date();
      // OneMap requires date as MM-DD-YYYY
      const mm2  = String(now.getMonth() + 1).padStart(2, '0');
      const dd   = String(now.getDate()).padStart(2, '0');
      const yyyy = now.getFullYear();
      const date = `${mm2}-${dd}-${yyyy}`;
      const hh   = String(now.getHours()).padStart(2, '0');
      const min  = String(now.getMinutes()).padStart(2, '0');
      const data = await safeFetch(
        `https://www.onemap.gov.sg/api/public/routingsvc/route` +
          `?start=${slat},${slng}&end=${elat},${elng}` +
          `&routeType=pt&date=${date}&time=${hh}:${min}:00&mode=TRANSIT`,
        { headers: { Authorization: process.env.ONEMAP_TOKEN } }
      );
      if (data.plan?.itineraries?.length) {
        const itin = data.plan.itineraries[0];
        routes.transit = {
          mode: 'transit',
          label: 'Bus / MRT',
          color: '#7c3aed',
          geometry: null,
          distance_m: Math.round(itin.walkDistance || 0),
          duration_s: itin.duration || 0,
          steps: parseOneMapLegs(itin.legs || []),
          fare: itin.fare,
        };
      }
    } catch (err) {
      console.warn('[Routing] OneMap transit failed:', err.message);
    }
  }

  // Always provide Google Maps transit deep-link
  routes.google_maps_transit =
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${slat},${slng}&destination=${elat},${elng}&travelmode=transit`;

  // ── Accessible stops from our own DB ──────────────────────────────────────
  const pad = 0.03;
  const bbox = [
    Math.min(slat, elat) - pad, Math.max(slat, elat) + pad,
    Math.min(slng, elng) - pad, Math.max(slng, elng) + pad,
  ];

  let dbStops = [];
  try {
    const { rows } = await dbQuery(
      `SELECT *,
        (COALESCE(wheelchair_accessible::int,0) + COALESCE(elevator::int,0) +
         COALESCE(braille_signage::int,0) + COALESCE(sign_language::int,0) +
         COALESCE(accessible_restroom::int,0) + COALESCE(quiet_room::int,0)) AS score
       FROM locations
       WHERE lat::float BETWEEN $1 AND $2
         AND lng::float BETWEEN $3 AND $4
       ORDER BY score DESC
       LIMIT 20`,
      [bbox[0], bbox[1], bbox[2], bbox[3]]
    );
    dbStops = rows;
  } catch (err) {
    console.warn('[Routing] DB stops query failed:', err.message);
  }

  // ── OSM accessibility nodes from Overpass ─────────────────────────────────
  let overpassNodes = [];
  try {
    overpassNodes = await fetchOverpassNodes(bbox[0], bbox[1], bbox[2], bbox[3]);
  } catch (err) {
    console.warn('[Routing] Overpass failed:', err.message);
  }

  // ── Recommend best mode ───────────────────────────────────────────────────
  const recommended = recommendMode(routes);

  res.json({
    routes,
    recommended,
    db_stops: dbStops,
    osm_nodes: overpassNodes,
  });
});

// ─── OSRM step extractor ─────────────────────────────────────────────────────
function extractOSRMSteps(legs, mode) {
  const steps = [];
  for (const leg of (legs || [])) {
    for (const step of (leg.steps || [])) {
      const { type = '', modifier = '' } = step.maneuver || {};
      const road = step.name ? ` on ${step.name}` : '';
      let instruction;
      switch (type) {
        case 'depart':        instruction = `Start${road}`; break;
        case 'arrive':        instruction = 'Arrive at your destination'; break;
        case 'turn':          instruction = `Turn ${modifier}${road}`; break;
        case 'continue':
        case 'new name':      instruction = `Continue${road}`; break;
        case 'merge':         instruction = `Merge ${modifier}${road}`; break;
        case 'roundabout':    instruction = `Enter the roundabout`; break;
        case 'exit roundabout': instruction = `Exit the roundabout${road}`; break;
        default:              instruction = `${type}${modifier ? ' ' + modifier : ''}${road}`; break;
      }
      if (step.distance < 5 && type !== 'arrive') continue;
      steps.push({
        instruction: cap(instruction.trim()),
        distance_m: Math.round(step.distance),
        duration_s: Math.round(step.duration),
        mode,
        type,
      });
    }
  }
  return steps;
}

// ─── ORS step extractor ───────────────────────────────────────────────────────
function extractORSSteps(segments) {
  const steps = [];
  for (const seg of (segments || [])) {
    for (const s of (seg.steps || [])) {
      steps.push({
        instruction: s.instruction,
        distance_m: Math.round(s.distance),
        duration_s: Math.round(s.duration),
        mode: 'wheelchair',
        type: 'continue',
      });
    }
  }
  return steps;
}

// ─── OneMap leg parser ────────────────────────────────────────────────────────
function parseOneMapLegs(legs) {
  return legs.map((leg) => {
    if (leg.mode === 'WALK') {
      return {
        instruction: `Walk ${Math.round(leg.distance || 0)} m`,
        distance_m: Math.round(leg.distance || 0),
        duration_s: leg.duration || 0,
        mode: 'walk',
        type: 'walk',
      };
    }
    const short = leg.routeShortName || '';
    const sign = leg.headsign || leg.to?.name || '';
    const from = leg.from?.name || '';
    const to = leg.to?.name || '';
    const modeLabel = leg.mode === 'RAIL' ? `MRT ${short}` : `Bus ${short}`;
    return {
      instruction: `Take ${modeLabel} towards ${sign} — board at ${from}, alight at ${to}`,
      distance_m: Math.round(leg.distance || 0),
      duration_s: leg.duration || 0,
      mode: leg.mode === 'RAIL' ? 'mrt' : 'bus',
      route: short,
      type: leg.mode === 'RAIL' ? 'mrt' : 'bus',
    };
  });
}

// ─── Overpass: wheelchair-accessible OSM nodes ────────────────────────────────
// Tries multiple public Overpass endpoints in order; skips on XML/rate-limit.
async function fetchOverpassNodes(minLat, maxLat, minLng, maxLng) {
  const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;
  const q = `[out:json][timeout:10];
(
  node["highway"="bus_stop"]["wheelchair"="yes"](${bbox});
  node["public_transport"="stop_position"]["wheelchair"="yes"](${bbox});
  node["railway"~"^(station|subway_entrance)$"](${bbox});
  node["wheelchair"="yes"]["amenity"~"^(toilets|hospital|clinic|pharmacy|bank|atm)$"](${bbox});
);
out body 50;`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(q)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'AccessLink/1.0',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      // Overpass returns XML on rate-limit/error even with [out:json]
      if (text.trim().startsWith('<')) continue;
      const data = JSON.parse(text);
      return (data.elements || [])
        .filter((el) => el.lat && el.lon)
        .slice(0, 50)
        .map((el) => ({
          id: el.id,
          lat: el.lat,
          lng: el.lon,
          name: el.tags?.name || formatTag(el.tags?.highway || el.tags?.amenity || el.tags?.railway || 'Stop'),
          type: el.tags?.highway || el.tags?.amenity || el.tags?.railway || 'stop',
          wheelchair: el.tags?.wheelchair,
          ref: el.tags?.ref || el.tags?.['uic_ref'] || null,
        }));
    } catch (_) {
      // try next endpoint
    }
  }
  return [];
}

// ─── Mode recommender ────────────────────────────────────────────────────────
function recommendMode(routes) {
  if (routes.wheelchair) return 'wheelchair';
  const walkDist = routes.walk?.distance_m ?? Infinity;
  if (walkDist <= 1500) return 'walk';
  if (routes.transit) return 'transit';
  if (walkDist <= 4000) return 'walk';
  return routes.drive ? 'drive' : 'walk';
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function formatTag(tag) {
  return tag ? tag.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Stop';
}

module.exports = router;
