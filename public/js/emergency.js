async function sendEmergencyHelp() {
  const lat = document.getElementById('emergency-lat').value;
  const lng = document.getElementById('emergency-lng').value;
  const message = document.getElementById('emergency-message').value;
  const needs = document.getElementById('emergency-needs').value;

  if (!lat || !lng) {
    showToast('Allow location access or enter coordinates', 'error');
    return;
  }
  if (!message.trim()) {
    showToast('Please describe what help you need', 'error');
    return;
  }

  const btn = document.getElementById('btn-send-help');
  btn.disabled = true;

  try {
    const result = await API.post('/emergency/help', {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      message: message.trim(),
      needs,
    });
    showToast(result.message, 'success');
    bootstrap.Modal.getInstance(document.getElementById('emergencyModal'))?.hide();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function captureEmergencyLocation() {
  if (!navigator.geolocation) {
    showToast('Geolocation not available', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('emergency-lat').value = pos.coords.latitude.toFixed(6);
      document.getElementById('emergency-lng').value = pos.coords.longitude.toFixed(6);
      document.getElementById('emergency-location-status').textContent =
        `Location captured: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
      showToast('Your location was captured', 'success');
    },
    () => showToast('Could not get your location', 'error'),
    { enableHighAccuracy: true }
  );
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-open-emergency')?.addEventListener('click', () => {
    captureEmergencyLocation();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('emergencyModal')).show();
  });

  document.getElementById('btn-send-help')?.addEventListener('click', sendEmergencyHelp);
  document.getElementById('btn-capture-location')?.addEventListener('click', captureEmergencyLocation);

  document.getElementById('fab-emergency')?.addEventListener('click', () => {
    captureEmergencyLocation();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('emergencyModal')).show();
  });
});
