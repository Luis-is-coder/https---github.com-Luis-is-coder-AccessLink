document.getElementById('report-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;

  const fd = new FormData(form);
  const params = new URLSearchParams(window.location.search);
  if (params.get('location_id')) fd.set('location_id', params.get('location_id'));

  try {
    await API.post('/reports', fd);
    showToast('Report submitted – thank you!', 'success');
    form.reset();
    setTimeout(() => (window.location.href = '/index.html'), 1000);
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const locId = params.get('location_id');
  if (locId) {
    const hidden = document.getElementById('location_id');
    if (hidden) hidden.value = locId;
    API.get('/locations/' + locId)
      .then((loc) => {
        const el = document.getElementById('report-location-name');
        if (el) el.textContent = 'Reporting for: ' + loc.name;
      })
      .catch(() => {});
  }
});
