async function initDashboard() {
  if (!API.getToken()) {
    window.location.href = '/login.html?redirect=/dashboard.html';
    return;
  }

  const user = API.getUser();
  if (!user || !['venue_owner', 'admin'].includes(user.role)) {
    showToast('Venue owner account required', 'error');
    setTimeout(() => (window.location.href = '/index.html'), 1500);
    return;
  }

  await loadStats();
  await loadMyLocations();
  await loadUnclaimed();
  bindEvents();
}

async function loadStats() {
  try {
    const stats = await API.get('/venues/stats');
    document.getElementById('stat-locations').textContent = stats.total_locations;
    document.getElementById('stat-reports').textContent = stats.total_reports;
    document.getElementById('stat-pending').textContent = stats.pending_reports;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadMyLocations() {
  const el = document.getElementById('my-locations');
  try {
    const locs = await API.get('/venues/my-locations');
    if (!locs.length) {
      el.innerHTML = '<p class="text-muted">No claimed locations yet. Claim one below.</p>';
      return;
    }
    el.innerHTML = locs
      .map(
        (loc) => `
      <div class="card mb-3">
        <div class="card-body">
          <div class="d-flex justify-content-between">
            <h6 class="card-title">${loc.name}</h6>
            ${loc.pending_reports ? `<span class="badge bg-warning">${loc.pending_reports} pending</span>` : ''}
          </div>
          <p class="small text-muted">${loc.address || ''}</p>
          <div class="mb-2">${renderTagsHtml(loc)}</div>
          <button class="btn btn-sm btn-primary btn-edit-loc" data-id="${loc.id}">Edit accessibility</button>
        </div>
      </div>`
      )
      .join('');

    el.querySelectorAll('.btn-edit-loc').forEach((btn) => {
      btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.id, 10), locs));
    });
  } catch (err) {
    el.innerHTML = '<p class="text-danger">Failed to load locations.</p>';
  }
}

async function loadUnclaimed() {
  const el = document.getElementById('unclaimed-list');
  try {
    const locs = await API.get('/venues/unclaimed');
    if (!locs.length) {
      el.innerHTML = '<p class="text-muted">All locations are claimed.</p>';
      return;
    }
    el.innerHTML = locs
      .map(
        (loc) => `
      <div class="d-flex justify-content-between align-items-center border-bottom py-2">
        <div><strong>${loc.name}</strong><br><small class="text-muted">${loc.category}</small></div>
        <button class="btn btn-sm btn-outline-success btn-claim" data-id="${loc.id}">Claim</button>
      </div>`
      )
      .join('');

    el.querySelectorAll('.btn-claim').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await API.post('/locations/' + btn.dataset.id + '/claim', {});
          showToast('Location claimed!', 'success');
          loadMyLocations();
          loadUnclaimed();
          loadStats();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    el.innerHTML = '<p class="text-muted">Could not load unclaimed locations.</p>';
  }
}

function openEditModal(id, locs) {
  const loc = locs.find((l) => l.id === id);
  if (!loc) return;

  document.getElementById('edit-loc-id').value = id;
  document.getElementById('edit-name').value = loc.name;
  document.getElementById('edit-description').value = loc.description || '';
  document.getElementById('edit-wheelchair').checked = loc.wheelchair_accessible;
  document.getElementById('edit-elevator').checked = loc.elevator;
  document.getElementById('edit-braille').checked = loc.braille_signage;
  document.getElementById('edit-quiet').checked = loc.quiet_room;
  document.getElementById('edit-signlang').checked = loc.sign_language;
  document.getElementById('edit-restroom').checked = loc.accessible_restroom;

  bootstrap.Modal.getOrCreateInstance(document.getElementById('editLocationModal')).show();
}

function bindEvents() {
  document.getElementById('edit-loc-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-loc-id').value;
    try {
      await API.put('/locations/' + id, {
        name: document.getElementById('edit-name').value,
        description: document.getElementById('edit-description').value,
        wheelchair_accessible: document.getElementById('edit-wheelchair').checked,
        elevator: document.getElementById('edit-elevator').checked,
        braille_signage: document.getElementById('edit-braille').checked,
        quiet_room: document.getElementById('edit-quiet').checked,
        sign_language: document.getElementById('edit-signlang').checked,
        accessible_restroom: document.getElementById('edit-restroom').checked,
      });
      showToast('Location updated', 'success');
      bootstrap.Modal.getInstance(document.getElementById('editLocationModal'))?.hide();
      loadMyLocations();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

document.addEventListener('DOMContentLoaded', initDashboard);
