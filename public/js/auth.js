document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const data = await API.post('/auth/login', {
      email: document.getElementById('email').value,
      password: document.getElementById('password').value,
    });
    API.setToken(data.token);
    API.setUser(data.user);
    showToast('Welcome back, ' + data.user.name + '!', 'success');
    setTimeout(() => {
      window.location.href = new URLSearchParams(window.location.search).get('redirect') || '/index.html';
    }, 500);
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
  }
});

document.getElementById('register-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const data = await API.post('/auth/register', {
      name: document.getElementById('name').value,
      email: document.getElementById('email').value,
      password: document.getElementById('password').value,
      phone: document.getElementById('phone').value || null,
      role: document.getElementById('role').value,
      disability_prefs: {
        mobility: document.getElementById('pref-mobility').checked,
        vision: document.getElementById('pref-vision').checked,
        hearing: document.getElementById('pref-hearing').checked,
      },
    });
    API.setToken(data.token);
    API.setUser(data.user);
    showToast('Account created!', 'success');
    setTimeout(() => (window.location.href = '/profile.html'), 500);
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
  }
});

document.getElementById('btn-logout')?.addEventListener('click', (e) => {
  e.preventDefault();
  API.logout();
});

document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!API.getToken()) {
    window.location.href = '/login.html?redirect=/profile.html';
    return;
  }
  try {
    const user = await API.put('/auth/profile', {
      name: document.getElementById('name').value,
      phone: document.getElementById('phone').value,
      emergency_contact: document.getElementById('emergency_contact').value,
      disability_prefs: {
        mobility: document.getElementById('pref-mobility').checked,
        vision: document.getElementById('pref-vision').checked,
        hearing: document.getElementById('pref-hearing').checked,
      },
    });
    API.setUser(user);
    showToast('Profile saved', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

async function loadProfile() {
  if (!API.getToken()) {
    window.location.href = '/login.html?redirect=/profile.html';
    return;
  }
  try {
    const user = await API.get('/auth/me');
    document.getElementById('name').value = user.name || '';
    document.getElementById('email').value = user.email || '';
    document.getElementById('phone').value = user.phone || '';
    document.getElementById('emergency_contact').value = user.emergency_contact || '';
    const prefs = user.disability_prefs || {};
    document.getElementById('pref-mobility').checked = !!prefs.mobility;
    document.getElementById('pref-vision').checked = !!prefs.vision;
    document.getElementById('pref-hearing').checked = !!prefs.hearing;
  } catch {
    API.logout();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('profile-form')) loadProfile();
});
