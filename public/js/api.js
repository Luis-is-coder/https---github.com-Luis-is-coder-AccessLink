/**
 * Shared API client and auth helpers
 */
const API = {
  base: '/api',

  getToken() {
    return localStorage.getItem('accesslink_token');
  },

  setToken(token) {
    if (token) localStorage.setItem('accesslink_token', token);
    else localStorage.removeItem('accesslink_token');
  },

  getUser() {
    const raw = localStorage.getItem('accesslink_user');
    return raw ? JSON.parse(raw) : null;
  },

  setUser(user) {
    if (user) localStorage.setItem('accesslink_user', JSON.stringify(user));
    else localStorage.removeItem('accesslink_user');
  },

  logout() {
    this.setToken(null);
    this.setUser(null);
    window.location.href = '/login.html';
  },

  async request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const res = await fetch(`${this.base}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  get(path) {
    return this.request(path);
  },

  post(path, body) {
    return this.request(path, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
  },

  put(path, body) {
    return this.request(path, { method: 'PUT', body: JSON.stringify(body) });
  },

  patch(path, body) {
    return this.request(path, { method: 'PATCH', body: JSON.stringify(body) });
  },

  delete(path) {
    return this.request(path, { method: 'DELETE' });
  },
};

function updateNavAuth() {
  const user = API.getUser();
  const loginLink = document.getElementById('nav-login');
  const userMenu = document.getElementById('nav-user-menu');
  const userName = document.getElementById('nav-user-name');

  if (user && userMenu) {
    if (loginLink) loginLink.classList.add('d-none');
    userMenu.classList.remove('d-none');
    if (userName) userName.textContent = user.name;
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) {
    alert(message);
    return;
  }
  const id = `toast-${Date.now()}`;
  const bg = type === 'error' ? 'danger' : type === 'success' ? 'success' : 'primary';
  container.insertAdjacentHTML(
    'beforeend',
    `<div id="${id}" class="toast align-items-center text-bg-${bg} border-0" role="alert" aria-live="assertive">
      <div class="d-flex">
        <div class="toast-body">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    </div>`
  );
  const el = document.getElementById(id);
  const toast = new bootstrap.Toast(el, { delay: 4000 });
  toast.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

function accessibilityTags(loc) {
  const tags = [];
  if (loc.wheelchair_accessible) tags.push({ icon: '♿', label: 'Wheelchair accessible' });
  if (loc.elevator) tags.push({ icon: '🛗', label: 'Elevator' });
  if (loc.braille_signage) tags.push({ icon: '⠿', label: 'Braille signage' });
  if (loc.quiet_room) tags.push({ icon: '🤫', label: 'Quiet room' });
  if (loc.sign_language) tags.push({ icon: '🤟', label: 'Sign language support' });
  if (loc.accessible_restroom) tags.push({ icon: '🚻', label: 'Accessible restroom' });
  return tags;
}

function renderTagsHtml(loc) {
  return accessibilityTags(loc)
    .map((t) => `<span class="badge bg-success me-1 mb-1" title="${t.label}">${t.icon} ${t.label}</span>`)
    .join('');
}

document.addEventListener('DOMContentLoaded', updateNavAuth);
