let map;
let markersLayer;
let locations = [];
let selectedId = null;
const markersById = {};

const DEFAULT_CENTER = [1.2900, 103.8500];
const DEFAULT_ZOOM = 13;

async function initMap() {
  map = L.map('map', { scrollWheelZoom: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    document.getElementById('report-lat').value = e.latlng.lat.toFixed(6);
    document.getElementById('report-lng').value = e.latlng.lng.toFixed(6);
  });

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.setView([pos.coords.latitude, pos.coords.longitude], 14);
        L.marker([pos.coords.latitude, pos.coords.longitude], {
          icon: L.divIcon({
            className: 'user-location-marker',
            html: '<div style="background:#2563eb;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.4)"></div>',
            iconSize: [20, 20],
          }),
        }).addTo(map).bindPopup('You are here');
      },
      () => {}
    );
  }

  await loadLocations();
  bindFilters();
}

async function loadLocations() {
  const params = new URLSearchParams();
  if (document.getElementById('filter-mobility')?.classList.contains('active')) params.set('mobility', 'true');
  if (document.getElementById('filter-vision')?.classList.contains('active')) params.set('vision', 'true');
  if (document.getElementById('filter-hearing')?.classList.contains('active')) params.set('hearing', 'true');
  const search = document.getElementById('search-input')?.value;
  if (search) params.set('search', search);

  try {
    locations = await API.get('/locations?' + params.toString());
    renderMarkers();
    renderSidebar();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function markerColor(loc) {
  if (loc.wheelchair_accessible && loc.verified) return '#059669';
  if (loc.wheelchair_accessible) return '#2563eb';
  return '#94a3b8';
}

function renderMarkers() {
  markersLayer.clearLayers();
  Object.keys(markersById).forEach((k) => delete markersById[k]);

  locations.forEach((loc) => {
    const marker = L.circleMarker([parseFloat(loc.lat), parseFloat(loc.lng)], {
      radius: 10,
      fillColor: markerColor(loc),
      color: '#fff',
      weight: 2,
      fillOpacity: 0.9,
    });

    marker.bindPopup(`<strong>${loc.name}</strong><br><small>${loc.address || loc.category || ''}</small>`);
    marker.on('click', () => selectLocation(loc.id));
    marker.addTo(markersLayer);
    markersById[loc.id] = marker;
  });
}

function buildPopupContent(loc) {
  return `
    <strong>${loc.name}</strong><br>
    <small>${loc.address || ''}</small><br>
    ${renderTagsHtml(loc)}
    <br><a href="#" onclick="selectLocation(${loc.id}); return false;">Details</a>
  `;
}

function renderSidebar() {
  const list = document.getElementById('location-list');
  if (!list) return;

  if (!locations.length) {
    list.innerHTML = '<p class="text-muted">No locations match your filters.</p>';
    return;
  }

  list.innerHTML = locations
    .map(
      (loc) => `
    <div class="location-card ${selectedId === loc.id ? 'active' : ''}" data-id="${loc.id}" role="button" tabindex="0" aria-label="View ${loc.name}">
      <div class="d-flex justify-content-between align-items-start">
        <h6 class="mb-1">${loc.name}</h6>
        ${loc.verified ? '<span class="badge bg-primary verified-badge">Verified</span>' : ''}
      </div>
      <small class="text-muted">${loc.address || loc.category}</small>
      <div class="mt-2">${renderTagsHtml(loc)}</div>
    </div>`
    )
    .join('');

  list.querySelectorAll('.location-card').forEach((card) => {
    card.addEventListener('click', () => selectLocation(parseInt(card.dataset.id, 10)));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectLocation(parseInt(card.dataset.id, 10));
      }
    });
  });
}

function selectLocation(id) {
  selectedId = id;
  const loc = locations.find((l) => l.id === id);
  if (!loc) return;

  renderSidebar();
  map.setView([parseFloat(loc.lat), parseFloat(loc.lng)], 16);

  // Open the marker popup on the map
  const marker = markersById[id];
  if (marker) marker.openPopup();

  // Populate and show the floating panel
  showLocationPanel(loc);
}

function showLocationPanel(loc) {
  const panel = document.getElementById('location-panel');
  if (!panel) return;

  document.getElementById('lp-category').textContent = loc.category || '';
  document.getElementById('lp-name').textContent = loc.name;
  document.getElementById('lp-address').textContent = loc.address || '';
  document.getElementById('lp-description').textContent = loc.description || 'No description yet.';
  document.getElementById('lp-tags').innerHTML = renderTagsHtml(loc);

  document.getElementById('lp-report').href = `/report.html?location_id=${loc.id}`;
  document.getElementById('lp-directions').href = `/itinerary.html?end_lat=${loc.lat}&end_lng=${loc.lng}&end_name=${encodeURIComponent(loc.name)}`;

  const ttsText = `${loc.name}. ${loc.description || ''}. ${accessibilityTags(loc).map((t) => t.label).join(', ')}`;
  document.getElementById('lp-tts-text').textContent = ttsText;

  panel.hidden = false;
}

function closeLocationPanel() {
  const panel = document.getElementById('location-panel');
  if (panel) panel.hidden = true;
}

function bindFilters() {
  ['mobility', 'vision', 'hearing'].forEach((type) => {
    document.getElementById(`filter-${type}`)?.addEventListener('click', (e) => {
      e.target.classList.toggle('active');
      loadLocations();
    });
  });

  document.getElementById('search-input')?.addEventListener(
    'input',
    debounce(() => loadLocations(), 300)
  );

  document.getElementById('btn-refresh')?.addEventListener('click', loadLocations);

  document.getElementById('toggle-sidebar')?.addEventListener('click', () => {
    document.querySelector('.map-sidebar')?.classList.toggle('collapsed');
  });

  document.getElementById('lp-close')?.addEventListener('click', closeLocationPanel);

  document.getElementById('lp-tts')?.addEventListener('click', () => {
    const text = document.getElementById('lp-tts-text')?.textContent;
    if (text && typeof A11y !== 'undefined') A11y.speak(text);
  });

  // Close panel when clicking the map background
  map.on('click', () => closeLocationPanel());
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

document.addEventListener('DOMContentLoaded', initMap);
