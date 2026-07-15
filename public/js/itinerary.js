'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
let itineraryMap;
let routeLayer;
let osmLayer;
let pickMode = null;
const pickMarkers = {};
const stopMarkers = [];
const searchTimers = {};
let currentResult = null;    // last /itinerary/plan response
let routingData = null;      // last /routing/plan response
let activeMode = null;       // currently displayed transport mode

const NOMINATIM = 'https://nominatim.openstreetmap.org';

// ─── Init ────────────────────────────────────────────────────────────────────
async function initItineraryPage() {
  const loggedIn = !!API.getToken();

  // Hide saved trips section for guests
  if (!loggedIn) {
    const savedSection = document.querySelector('.mt-3:has(#saved-itineraries)');
    if (savedSection) savedSection.style.display = 'none';
  }

  itineraryMap = L.map('itinerary-map').setView([1.29, 103.85], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(itineraryMap);

  routeLayer = L.layerGroup().addTo(itineraryMap);
  osmLayer   = L.layerGroup().addTo(itineraryMap);

  itineraryMap.on('click', onMapPick);
  requestAnimationFrame(() => itineraryMap.invalidateSize());

  document.getElementById('itinerary-form').addEventListener('submit', planTrip);
  document.getElementById('btn-use-location-start').addEventListener('click', () => useGeolocation('start'));
  document.getElementById('btn-use-location-end').addEventListener('click', () => useGeolocation('end'));
  document.getElementById('btn-pick-start').addEventListener('click', () => activatePickMode('start'));
  document.getElementById('btn-pick-end').addEventListener('click', () => activatePickMode('end'));
  document.getElementById('pick-cancel').addEventListener('click', cancelPickMode);

  // Mode tab clicks — set up ONCE via delegation so repeated planTrip() calls don't stack listeners
  document.querySelector('.mode-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.mode-tab');
    if (!tab || tab.disabled || tab.classList.contains('d-none')) return;
    const mode = tab.dataset.mode;
    if (!routingData?.routes?.[mode]) return;
    document.querySelectorAll('.mode-tab').forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
      t.textContent = t.dataset.label;
    });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    renderRouteMode(routingData, mode);
    renderModeSummary(routingData.routes[mode]);
    renderDirections(routingData.routes[mode]);
    renderRouteSummary(mode);
  });

  initSearch('start');
  initSearch('end');
  loadSavedItineraries();
}

// ─── Address Search (Nominatim) ───────────────────────────────────────────────
function initSearch(which) {
  const input    = document.getElementById(`${which}-search`);
  const dropdown = document.getElementById(`${which}-search-results`);

  input.addEventListener('input', () => {
    clearTimeout(searchTimers[which]);
    const q = input.value.trim();
    if (q.length < 3) { closeDropdown(which); return; }
    searchTimers[which] = setTimeout(() => fetchPlaces(q, which), 380);
  });

  input.addEventListener('blur', () => setTimeout(() => closeDropdown(which), 200));

  input.addEventListener('keydown', (e) => {
    const items   = [...dropdown.querySelectorAll('[data-result]')];
    const current = dropdown.querySelector('[data-result].focused');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!current) items[0]?.classList.add('focused');
      else { current.classList.remove('focused'); (current.nextElementSibling || items[0]).classList.add('focused'); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (current) { current.classList.remove('focused'); (current.previousElementSibling || items[items.length - 1]).classList.add('focused'); }
    } else if (e.key === 'Enter') {
      const focused = dropdown.querySelector('[data-result].focused');
      if (focused) { e.preventDefault(); focused.dispatchEvent(new MouseEvent('mousedown')); }
    } else if (e.key === 'Escape') {
      closeDropdown(which); cancelPickMode();
    }
  });
}

async function fetchPlaces(query, which) {
  try {
    const url = `${NOMINATIM}/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=sg&addressdetails=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en', 'User-Agent': 'AccessLink/1.0' } });
    if (!res.ok) return;
    renderSearchDropdown(await res.json(), which);
  } catch { closeDropdown(which); }
}

function renderSearchDropdown(results, which) {
  const dropdown = document.getElementById(`${which}-search-results`);
  const input    = document.getElementById(`${which}-search`);
  if (!results.length) {
    dropdown.innerHTML = '<div class="search-dropdown-item text-muted fst-italic">No results found</div>';
    dropdown.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
    return;
  }
  dropdown.innerHTML = results.map((r, i) => {
    const short = r.display_name.split(',').slice(0, 3).join(', ');
    return `<div class="search-dropdown-item" data-result="${i}"
                 data-lat="${r.lat}" data-lng="${r.lon}"
                 data-name="${esc(r.display_name)}"
                 role="option" tabindex="-1">${esc(short)}</div>`;
  }).join('');
  dropdown.querySelectorAll('[data-result]').forEach((item) =>
    item.addEventListener('mousedown', () =>
      selectPlace(item.dataset.lat, item.dataset.lng, item.dataset.name, which)
    )
  );
  dropdown.classList.add('open');
  input.setAttribute('aria-expanded', 'true');
}

function closeDropdown(which) {
  const dropdown = document.getElementById(`${which}-search-results`);
  dropdown.classList.remove('open');
  dropdown.innerHTML = '';
  document.getElementById(`${which}-search`)?.setAttribute('aria-expanded', 'false');
}

function selectPlace(lat, lng, fullName, which) {
  const latN = parseFloat(lat), lngN = parseFloat(lng);
  document.getElementById(`${which}_lat`).value = latN.toFixed(6);
  document.getElementById(`${which}_lng`).value = lngN.toFixed(6);
  const short = fullName.split(',').slice(0, 2).join(', ');
  document.getElementById(`${which}-search`).value = short;
  document.getElementById(`${which}-place-name`).textContent = fullName.split(',').slice(0, 5).join(', ');
  closeDropdown(which);
  itineraryMap.panTo([latN, lngN]);
  placePreviewMarker(latN, lngN, which, short);
}

// ─── Reverse Geocoding ────────────────────────────────────────────────────────
async function reverseGeocode(lat, lng, which) {
  try {
    const res  = await fetch(`${NOMINATIM}/reverse?format=json&lat=${lat}&lon=${lng}`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'AccessLink/1.0' } });
    if (!res.ok) return;
    const data = await res.json();
    if (data.display_name) {
      document.getElementById(`${which}-search`).value =
        data.display_name.split(',').slice(0, 2).join(', ');
      document.getElementById(`${which}-place-name`).textContent =
        data.display_name.split(',').slice(0, 5).join(', ');
    }
  } catch { /* best-effort */ }
}

// ─── Pick Mode ────────────────────────────────────────────────────────────────
function activatePickMode(which) {
  if (pickMode === which) { cancelPickMode(); return; }
  pickMode = which;
  setPickBtnState('start', which === 'start');
  setPickBtnState('end',   which === 'end');
  itineraryMap.getContainer().style.cursor = 'crosshair';
  document.getElementById('pick-banner-label').textContent = which;
  document.getElementById('pick-banner').classList.remove('d-none');
}

function cancelPickMode() {
  pickMode = null;
  setPickBtnState('start', false);
  setPickBtnState('end',   false);
  itineraryMap.getContainer().style.cursor = '';
  document.getElementById('pick-banner').classList.add('d-none');
}

function setPickBtnState(which, active) {
  const btn = document.getElementById(`btn-pick-${which}`);
  if (!btn) return;
  btn.classList.toggle('btn-primary',         active);
  btn.classList.toggle('btn-outline-primary', !active);
  btn.textContent = active ? 'Cancel pick' : 'Pick on map';
}

async function onMapPick(e) {
  if (!pickMode) return;
  const { lat, lng } = e.latlng;
  const which = pickMode;
  cancelPickMode();
  document.getElementById(`${which}_lat`).value = lat.toFixed(6);
  document.getElementById(`${which}_lng`).value = lng.toFixed(6);
  document.getElementById(`${which}-search`).value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  document.getElementById(`${which}-place-name`).textContent = 'Looking up address...';
  placePreviewMarker(lat, lng, which, which === 'start' ? 'Start point' : 'End point');
  await reverseGeocode(lat, lng, which);
}

function placePreviewMarker(lat, lng, which, label) {
  if (pickMarkers[which]) pickMarkers[which].remove();
  pickMarkers[which] = L.marker([lat, lng], { icon: createEndpointIcon(which), zIndexOffset: 500 })
    .addTo(itineraryMap)
    .bindPopup(`<strong>${label}</strong>`)
    .openPopup();
}

// ─── Geolocation ──────────────────────────────────────────────────────────────
function useGeolocation(which) {
  if (!navigator.geolocation) { showToast('Geolocation not available.', 'error'); return; }
  showToast('Getting your location...', 'info');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      document.getElementById(`${which}_lat`).value = lat.toFixed(6);
      document.getElementById(`${which}_lng`).value = lng.toFixed(6);
      document.getElementById(`${which}-search`).value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      document.getElementById(`${which}-place-name`).textContent = 'Looking up address...';
      itineraryMap.setView([lat, lng], 15);
      placePreviewMarker(lat, lng, which, which === 'start' ? 'Your start location' : 'Your end location');
      await reverseGeocode(lat, lng, which);
    },
    () => showToast('Could not get location. Check browser permissions.', 'error'),
    { timeout: 8000 }
  );
}

// ─── Plan Trip ────────────────────────────────────────────────────────────────
async function planTrip(e) {
  e.preventDefault();

  const startLat = parseFloat(document.getElementById('start_lat').value);
  const startLng = parseFloat(document.getElementById('start_lng').value);
  const endLat   = parseFloat(document.getElementById('end_lat').value);
  const endLng   = parseFloat(document.getElementById('end_lng').value);

  if ([startLat, startLng, endLat, endLng].some(isNaN)) {
    showToast('Please set both start and end points.', 'error');
    return;
  }

  const btn     = document.getElementById('btn-plan');
  const spinner = document.getElementById('btn-plan-spinner');
  const btnText = document.getElementById('btn-plan-text');
  btn.disabled  = true;
  spinner.classList.remove('d-none');
  btnText.textContent = 'Planning...';

  try {
    // 1. Get real routes from OSRM + Overpass (always, even for guests)
    const routingRes = await API.get(
      `/routing/plan?start_lat=${startLat}&start_lng=${startLng}&end_lat=${endLat}&end_lng=${endLng}`
    );
    routingData = routingRes;

    // 2. Save trip + get personalised stops (logged-in users only)
    if (API.getToken()) {
      try {
        const tripResult = await API.post('/itinerary/plan', {
          title:     document.getElementById('title').value.trim() || 'My Accessible Trip',
          start_lat: startLat, start_lng: startLng,
          end_lat:   endLat,   end_lng:   endLng,
          notes:     document.getElementById('notes').value,
        });
        currentResult = tripResult;
        renderStops(tripResult.suggested_stops, routingData.db_stops);
        showToast(
          `Route ready — ${tripResult.suggested_stops.length} accessible stop${tripResult.suggested_stops.length !== 1 ? 's' : ''} found`,
          'success'
        );
        loadSavedItineraries();
      } catch {
        // saving failed — still show route with routing stops
        currentResult = { route: { start: { lat: startLat, lng: startLng }, end: { lat: endLat, lng: endLng } }, suggested_stops: [] };
        renderStops([], routingData.db_stops);
        showToast('Route ready (trip could not be saved)', 'warning');
      }
    } else {
      // Guest: use route start/end for rendering, show DB stops from routing
      currentResult = { route: { start: { lat: startLat, lng: startLng }, end: { lat: endLat, lng: endLng } }, suggested_stops: [] };
      renderStops([], routingData.db_stops);
      showToast('Route ready — <a href="/login.html?redirect=/itinerary.html" class="text-white fw-bold">Log in</a> to save this trip', 'info');
    }

    // 3. Render route on map
    renderRouteMode(routingData, routingData.recommended);
    renderRouteOptions(routingData);
    renderRouteSummary(routingData.recommended);
  } catch (err) {
    showToast(err.message || 'Failed to plan trip. Please try again.', 'error');
  } finally {
    btn.disabled = false;
    spinner.classList.add('d-none');
    btnText.textContent = 'Plan accessible route';
  }
}

// ─── Render Real Route on Map ─────────────────────────────────────────────────
function renderRouteMode(data, mode) {
  Object.values(pickMarkers).forEach((m) => m.remove());
  Object.keys(pickMarkers).forEach((k) => delete pickMarkers[k]);
  stopMarkers.forEach((m) => m.remove());
  stopMarkers.length = 0;
  routeLayer.clearLayers();
  osmLayer.clearLayers();

  const routes    = data.routes || {};
  const route     = routes[mode] || routes.walk || Object.values(routes).find((r) => r.geometry);
  const fallback  = !route;

  if (!route && !currentResult) return;

  const startCoord = currentResult?.route
    ? [currentResult.route.start.lat, currentResult.route.start.lng]
    : null;
  const endCoord   = currentResult?.route
    ? [currentResult.route.end.lat,   currentResult.route.end.lng]
    : null;

  if (route?.geometry) {
    // Real road geometry from OSRM / ORS
    const color = route.color || '#2563eb';
    L.geoJSON(route.geometry, {
      style: { color, weight: 5, opacity: 0.85, lineJoin: 'round', lineCap: 'round' },
    }).addTo(routeLayer);
  } else if (startCoord && endCoord) {
    // Fallback: straight dashed line
    L.polyline([startCoord, endCoord], {
      color: '#2563eb', weight: 4, dashArray: '8 8', opacity: 0.6,
    }).addTo(routeLayer);
  }

  // Start / end markers
  if (startCoord) {
    L.marker(startCoord, { icon: createEndpointIcon('start'), zIndexOffset: 1000 })
      .addTo(routeLayer).bindPopup('<strong>Start</strong>');
  }
  if (endCoord) {
    L.marker(endCoord, { icon: createEndpointIcon('end'), zIndexOffset: 1000 })
      .addTo(routeLayer).bindPopup('<strong>End</strong>');
  }

  // Accessible DB stops as numbered markers
  const stops = currentResult?.suggested_stops || data.db_stops || [];
  const sortedStops = startCoord && endCoord
    ? sortStopsAlongRoute(stops,
        { lat: startCoord[0], lng: startCoord[1] },
        { lat: endCoord[0],   lng: endCoord[1] })
    : stops;

  sortedStops.forEach((stop, i) => {
    const lat = parseFloat(stop.lat), lng = parseFloat(stop.lng);
    const marker = L.marker([lat, lng], { icon: createNumberedIcon(i + 1) })
      .addTo(routeLayer)
      .bindPopup(buildStopPopup(stop, i + 1));
    stopMarkers.push(marker);
  });

  // OSM wheelchair-accessible nodes (orange markers)
  (data.osm_nodes || []).forEach((node) => {
    L.circleMarker([node.lat, node.lng], {
      radius: 7, fillColor: '#f97316', color: '#fff',
      weight: 2, fillOpacity: 0.85,
    })
      .addTo(osmLayer)
      .bindPopup(
        `<strong>${esc(node.name)}</strong><br>` +
        `<small>${formatNodeType(node.type)}` +
        (node.ref ? ` · ${node.ref}` : '') + `</small>` +
        (node.wheelchair === 'yes' ? '<br><span class="badge bg-success">Wheelchair</span>' : '')
      );
  });

  // Fit map bounds
  const allPts = [];
  if (route?.geometry) {
    L.geoJSON(route.geometry).eachLayer((l) => {
      if (l.getLatLngs) l.getLatLngs().flat(2).forEach((p) => allPts.push([p.lat, p.lng]));
    });
  }
  if (startCoord) allPts.push(startCoord);
  if (endCoord)   allPts.push(endCoord);
  if (allPts.length) itineraryMap.fitBounds(L.latLngBounds(allPts), { padding: [40, 40] });

  activeMode = mode;
}

// ─── Transport Mode Tabs ─────────────────────────────────────────────────────
function renderRouteOptions(data) {
  const panel   = document.getElementById('route-options');
  const gLink   = document.getElementById('gmaps-transit-link');
  const routes  = data.routes || {};
  const avail   = ['walk', 'drive', 'transit', 'wheelchair'].filter((m) => routes[m]);

  // Show/hide tabs based on available routes
  ['walk', 'drive', 'transit', 'wheelchair'].forEach((m) => {
    const tab = document.getElementById(`tab-${m}`);
    if (!tab) return;
    const visible = routes[m] || m === 'transit'; // transit tab always shown (Google Maps fallback)
    tab.classList.toggle('d-none', !visible);
    tab.disabled = !routes[m] && m === 'transit' && !data.routes?.google_maps_transit;
  });

  // Google Maps transit link
  if (data.routes?.google_maps_transit) {
    gLink.href = data.routes.google_maps_transit;
    gLink.classList.remove('d-none');
  }

  panel.classList.remove('d-none');

  // Reset all tab labels and active state (so re-planning doesn't stack ★)
  document.querySelectorAll('.mode-tab').forEach((t) => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
    t.textContent = t.dataset.label;
  });

  // Mark and activate the recommended tab
  const recTab = document.getElementById(`tab-${data.recommended}`);
  if (recTab && !recTab.classList.contains('d-none')) {
    recTab.classList.add('active');
    recTab.setAttribute('aria-selected', 'true');
    recTab.textContent = `${recTab.dataset.label} ★`;
  }

  renderModeSummary(routes[data.recommended] || Object.values(routes).find((r) => r?.distance_m));
  renderDirections(routes[data.recommended] || Object.values(routes).find((r) => r?.steps?.length));
}

function renderModeSummary(route) {
  const el = document.getElementById('mode-summary');
  if (!el || !route) { el && (el.innerHTML = ''); return; }

  const distStr = route.distance_m >= 1000
    ? `${(route.distance_m / 1000).toFixed(1)} km`
    : `${route.distance_m} m`;
  const mins = Math.round(route.duration_s / 60);
  const timeStr = mins >= 60
    ? `${Math.floor(mins / 60)}h ${mins % 60}m`
    : `${mins} min`;
  const fareStr = route.fare ? ` · ~$${parseFloat(route.fare).toFixed(2)}` : '';

  el.innerHTML = `
    <div class="d-flex gap-3 align-items-center flex-wrap">
      <span class="fw-bold">${distStr}</span>
      <span class="text-muted small">·</span>
      <span>${timeStr}${fareStr}</span>
      ${!route.geometry ? '<span class="badge bg-warning text-dark">Live map not available</span>' : ''}
    </div>`;
}

function renderDirections(route) {
  const el = document.getElementById('directions-panel');
  if (!el) return;
  if (!route?.steps?.length) {
    el.innerHTML = route
      ? '<p class="text-muted small mb-0">No step-by-step details available.</p>'
      : '';
    return;
  }

  el.innerHTML = `
    <div class="directions-list">
      ${route.steps.map((step, i) => `
        <div class="direction-step">
          <div class="step-icon ${step.mode}">${stepIcon(step.mode, step.type)}</div>
          <div class="step-body">
            <div class="step-text">${esc(step.instruction)}</div>
            ${step.distance_m > 0
              ? `<small class="text-muted">${step.distance_m >= 1000
                  ? (step.distance_m / 1000).toFixed(1) + ' km'
                  : step.distance_m + ' m'}
                 · ${Math.max(1, Math.round(step.duration_s / 60))} min</small>`
              : ''}
          </div>
        </div>`).join('')}
    </div>`;
}

function stepIcon(mode, type) {
  if (mode === 'bus')         return 'B';
  if (mode === 'mrt')         return 'M';
  if (mode === 'drive')       return 'C';
  if (mode === 'wheelchair')  return 'W';
  // Walk step arrows
  if (type === 'arrive')  return '✓';
  if (type === 'depart')  return '•';
  if (type === 'turn')    return '↱';
  return '↑';
}

// ─── Render Route Summary Stats ───────────────────────────────────────────────
function renderRouteSummary(mode) {
  const route = routingData?.routes?.[mode];
  if (!route && !currentResult) return;

  const dist = route
    ? (route.distance_m >= 1000
        ? `${(route.distance_m / 1000).toFixed(1)} km`
        : `${route.distance_m} m`)
    : '—';

  const mins = route ? Math.round(route.duration_s / 60) : null;
  const time = mins != null
    ? (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`)
    : '—';

  const stops = (currentResult?.suggested_stops?.length ?? routingData?.db_stops?.length ?? 0);

  document.getElementById('summary-distance').textContent = dist;
  document.getElementById('summary-time').textContent     = time;
  document.getElementById('summary-stops').textContent    = stops;
  document.getElementById('route-summary').classList.remove('d-none');
}

// ─── Accessible Stops Carousel ────────────────────────────────────────────────
function renderStops(dbStops, extraStops) {
  const el = document.getElementById('suggested-stops');
  if (!el) return;

  // Merge DB stops from itinerary/plan and routing/plan, deduplicate by id
  const all   = [...(dbStops || []), ...(extraStops || [])];
  const seen  = new Set();
  const stops = all.filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });

  if (!stops.length) {
    el.innerHTML = '<p class="text-muted small mb-0 py-1">No accessible stops found nearby.</p>';
    return;
  }

  const start = currentResult?.route?.start;
  const end   = currentResult?.route?.end;
  const sorted = start && end ? sortStopsAlongRoute(stops, start, end) : stops;

  el.innerHTML = `<div class="stops-scroll">
    ${sorted.map((s, i) => {
      const tags    = accessibilityTags(s);
      const feat    = tags.length;                      // 0–6 actual features
      const pct     = Math.round((feat / 6) * 100);
      const color   = pct >= 67 ? '#059669' : pct >= 34 ? '#d97706' : '#dc2626';
      const visible = tags.slice(0, 3);
      const extra   = tags.length - 3;
      return `<div class="stop-card" data-stop-index="${i}" role="button" tabindex="0"
                   aria-label="Stop ${i+1}: ${esc(s.name)}, ${feat} of 6 accessibility features">
                <div class="stop-number">${i+1}</div>
                <div class="stop-content">
                  <div class="stop-name" title="${esc(s.name)}">${esc(s.name)}</div>
                  <div class="score-bar-bg">
                    <div class="score-bar-fill" style="width:${pct}%;background:${color}"></div>
                  </div>
                  <div class="d-flex justify-content-between">
                    <small class="text-muted">${s.distance_km != null ? s.distance_km.toFixed(1)+' km' : (s.category || '')}</small>
                    <small style="color:${color};font-weight:600">${feat}/6</small>
                  </div>
                  ${visible.length ? `<div class="tags-row mt-1">
                    ${visible.map((t) => `<span class="badge bg-success me-1" title="${t.label}">${t.icon}</span>`).join('')}
                    ${extra > 0 ? `<span class="badge bg-secondary">+${extra}</span>` : ''}
                  </div>` : ''}
                </div>
              </div>`;
    }).join('')}
  </div>`;

  el.querySelectorAll('.stop-card').forEach((card) => {
    const idx    = parseInt(card.dataset.stopIndex);
    const toggle = () => {
      el.querySelectorAll('.stop-card').forEach((c) => c.classList.remove('highlighted'));
      card.classList.add('highlighted');
      const m = stopMarkers[idx];
      if (m) { itineraryMap.panTo(m.getLatLng(), { animate: true }); m.openPopup(); }
    };
    card.addEventListener('click', toggle);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

// ─── Saved Trips ──────────────────────────────────────────────────────────────
async function loadSavedItineraries() {
  const el = document.getElementById('saved-itineraries');
  if (!el) return;
  try {
    const items = await API.get('/itinerary');
    if (!items.length) { el.innerHTML = '<p class="text-muted small mb-0">No saved trips yet.</p>'; return; }

    el.innerHTML = items.map((it) => `
      <div class="saved-trip-item">
        <div class="min-w-0 flex-grow-1">
          <div class="fw-semibold small text-truncate">${esc(it.title)}</div>
          <small class="text-muted">${new Date(it.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</small>
        </div>
        <div class="d-flex gap-1 flex-shrink-0">
          <button type="button" class="btn btn-xs btn-outline-primary btn-view" data-id="${it.id}">View</button>
          <button type="button" class="btn btn-xs btn-outline-danger btn-del"  data-id="${it.id}">Del</button>
        </div>
      </div>`).join('');

    el.querySelectorAll('.btn-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const trip = items.find((i) => String(i.id) === btn.dataset.id);
        if (!confirm(`Delete "${trip?.title || 'this trip'}"?`)) return;
        try {
          await API.delete('/itinerary/' + btn.dataset.id);
          loadSavedItineraries();
          showToast('Trip deleted', 'success');
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    el.querySelectorAll('.btn-view').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const trip  = await API.get('/itinerary/' + btn.dataset.id);
          const stops = typeof trip.waypoints === 'string' ? JSON.parse(trip.waypoints) : trip.waypoints || [];
          currentResult = {
            route: {
              start: { lat: parseFloat(trip.start_lat), lng: parseFloat(trip.start_lng) },
              end:   { lat: parseFloat(trip.end_lat),   lng: parseFloat(trip.end_lng) },
            },
            suggested_stops: stops,
          };

          // Re-fetch live routing for saved trip coordinates
          try {
            routingData = await API.get(
              `/routing/plan?start_lat=${trip.start_lat}&start_lng=${trip.start_lng}` +
              `&end_lat=${trip.end_lat}&end_lng=${trip.end_lng}`
            );
          } catch { routingData = null; }

          if (routingData) {
            renderRouteMode(routingData, routingData.recommended);
            renderRouteOptions(routingData);
            renderRouteSummary(routingData.recommended);
          } else {
            renderLegacyRoute(currentResult);
          }
          renderStops(stops, routingData?.db_stops);

          document.getElementById('title').value    = trip.title;
          document.getElementById('notes').value    = trip.notes || '';
          document.getElementById('start_lat').value = trip.start_lat;
          document.getElementById('start_lng').value = trip.start_lng;
          document.getElementById('end_lat').value   = trip.end_lat;
          document.getElementById('end_lng').value   = trip.end_lng;

          reverseGeocode(parseFloat(trip.start_lat), parseFloat(trip.start_lng), 'start');
          reverseGeocode(parseFloat(trip.end_lat),   parseFloat(trip.end_lng),   'end');
          showToast(`Loaded: ${trip.title}`, 'success');
        } catch (err) { showToast('Could not load trip', 'error'); }
      });
    });
  } catch { el.innerHTML = '<p class="text-muted small mb-0">Could not load saved trips.</p>'; }
}

// Fallback render for saved trips with no fresh routing data
function renderLegacyRoute(result) {
  Object.values(pickMarkers).forEach((m) => m.remove());
  Object.keys(pickMarkers).forEach((k) => delete pickMarkers[k]);
  stopMarkers.forEach((m) => m.remove());
  stopMarkers.length = 0;
  routeLayer.clearLayers();
  osmLayer.clearLayers();

  const { start, end } = result.route;
  const sorted = sortStopsAlongRoute(result.suggested_stops, start, end);
  const waypts = [[start.lat, start.lng], ...sorted.map((s) => [parseFloat(s.lat), parseFloat(s.lng)]), [end.lat, end.lng]];

  L.polyline(waypts, { color: '#2563eb', weight: 4, opacity: 0.8, dashArray: '8 8' }).addTo(routeLayer);
  L.marker([start.lat, start.lng], { icon: createEndpointIcon('start'), zIndexOffset: 1000 }).addTo(routeLayer).bindPopup('<strong>Start</strong>');
  L.marker([end.lat,   end.lng],   { icon: createEndpointIcon('end'),   zIndexOffset: 1000 }).addTo(routeLayer).bindPopup('<strong>End</strong>');

  sorted.forEach((stop, i) => {
    const m = L.marker([parseFloat(stop.lat), parseFloat(stop.lng)], { icon: createNumberedIcon(i + 1) })
      .addTo(routeLayer).bindPopup(buildStopPopup(stop, i + 1));
    stopMarkers.push(m);
  });

  itineraryMap.fitBounds(L.latLngBounds(waypts), { padding: [40, 40] });
}

// ─── Map Icon Helpers ─────────────────────────────────────────────────────────
function createEndpointIcon(type) {
  const color = type === 'start' ? '#059669' : '#dc2626';
  const label = type === 'start' ? 'S' : 'E';
  return L.divIcon({
    html: `<div style="background:${color};color:#fff;width:30px;height:30px;border-radius:50%;
                display:flex;align-items:center;justify-content:center;
                font-weight:700;font-size:13px;border:3px solid #fff;
                box-shadow:0 2px 8px rgba(0,0,0,0.35);">${label}</div>`,
    className: '', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -16],
  });
}

function createNumberedIcon(num) {
  return L.divIcon({
    html: `<div style="background:#2563eb;color:#fff;width:26px;height:26px;border-radius:50%;
                display:flex;align-items:center;justify-content:center;
                font-weight:700;font-size:11px;border:2px solid #fff;
                box-shadow:0 2px 6px rgba(0,0,0,0.3);">${num}</div>`,
    className: '', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14],
  });
}

function buildStopPopup(stop, num) {
  const tags = accessibilityTags(stop);
  const feat = tags.length;
  const tagsHtml = tags.map((t) => `${t.icon} ${t.label}`).join('<br>');
  const cat  = stop.category ? `<br><small class="text-muted">${stop.category}</small>` : '';
  return `<div style="min-width:160px"><strong>#${num} ${esc(stop.name)}</strong>${cat}
          <br><small>${feat}/6 accessibility features</small>
          ${stop.distance_km ? `<br><small>${stop.distance_km.toFixed(1)} km from route</small>` : ''}
          ${tagsHtml ? `<div style="margin-top:4px;font-size:12px">${tagsHtml}</div>` : ''}</div>`;
}

// ─── Geospatial Helpers ───────────────────────────────────────────────────────
function sortStopsAlongRoute(stops, start, end) {
  const dLat = end.lat - start.lat, dLng = end.lng - start.lng;
  const len2 = dLat * dLat + dLng * dLng;
  return [...stops].sort((a, b) => {
    const proj = (s) => len2
      ? ((parseFloat(s.lat) - start.lat) * dLat + (parseFloat(s.lng) - start.lng) * dLng) / len2
      : 0;
    return proj(a) - proj(b);
  });
}

function formatNodeType(type) {
  const map = {
    bus_stop: 'Bus stop', station: 'MRT station', subway_entrance: 'MRT entrance',
    taxi: 'Taxi stand', toilets: 'Accessible toilets', hospital: 'Hospital',
    pharmacy: 'Pharmacy', bank: 'Bank', atm: 'ATM',
  };
  return map[type] || (type ? type.replace(/_/g, ' ') : 'Stop');
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function esc(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', initItineraryPage);
