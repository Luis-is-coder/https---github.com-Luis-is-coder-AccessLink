let map;
let markersLayer;
let locations = [];
let selectedId = null;

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
  locations.forEach((loc) => {
    const marker = L.circleMarker([parseFloat(loc.lat), parseFloat(loc.lng)], {
      radius: 10,
      fillColor: markerColor(loc),
      color: '#fff',
      weight: 2,
      fillOpacity: 0.9,
    });

    marker.bindPopup(buildPopupContent(loc));
    marker.on('click', () => selectLocation(loc.id));
    marker.addTo(markersLayer);
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

  const detail = document.getElementById('location-detail');
  if (detail) {
    detail.innerHTML = `
      <h5>${loc.name}</h5>
      <p class="text-muted mb-2">${loc.address || ''}</p>
      <p>${loc.description || 'No description yet.'}</p>
      <div class="mb-3">${renderTagsHtml(loc)}</div>
      <div class="d-flex gap-2 flex-wrap">
        <a href="/report.html?location_id=${loc.id}" class="btn btn-sm btn-outline-primary">Report update</a>
        <button class="btn btn-sm btn-outline-secondary" onclick="A11y.speak(document.getElementById('location-detail-text').textContent)">Read aloud</button>
      </div>
      <div id="location-detail-text" class="visually-hidden">${loc.name}. ${loc.description || ''}. ${accessibilityTags(loc).map((t) => t.label).join(', ')}</div>
    `;
  }
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
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

document.addEventListener('DOMContentLoaded', initMap);
