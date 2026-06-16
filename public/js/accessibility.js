/**
 * Accessibility enhancements: high contrast, large text, TTS, voice commands
 */
const A11y = {
  init() {
    this.applySavedPrefs();
    this.bindToolbar();
    this.initVoiceCommands();
  },

  applySavedPrefs() {
    if (localStorage.getItem('al_high_contrast') === '1') {
      document.body.classList.add('high-contrast');
    }
    if (localStorage.getItem('al_large_text') === '1') {
      document.body.classList.add('large-text');
    }
  },

  bindToolbar() {
    document.getElementById('btn-high-contrast')?.addEventListener('click', () => {
      document.body.classList.toggle('high-contrast');
      localStorage.setItem('al_high_contrast', document.body.classList.contains('high-contrast') ? '1' : '0');
      showToast('High contrast mode ' + (document.body.classList.contains('high-contrast') ? 'on' : 'off'));
    });

    document.getElementById('btn-large-text')?.addEventListener('click', () => {
      document.body.classList.toggle('large-text');
      localStorage.setItem('al_large_text', document.body.classList.contains('large-text') ? '1' : '0');
      showToast('Large text ' + (document.body.classList.contains('large-text') ? 'on' : 'off'));
    });

    document.getElementById('btn-tts')?.addEventListener('click', () => {
      const detail = document.getElementById('location-detail-text')?.textContent;
      if (detail) this.speak(detail);
      else showToast('Select a location first', 'error');
    });
  },

  speak(text) {
    if (!('speechSynthesis' in window)) {
      showToast('Text-to-speech not supported in this browser', 'error');
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  },

  initVoiceCommands() {
    const btn = document.getElementById('btn-voice');
    if (!btn) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      btn.disabled = true;
      btn.title = 'Voice commands not supported';
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    btn.addEventListener('click', () => {
      recognition.start();
      showToast('Listening… say "show map", "help", or "filter mobility"');
    });

    recognition.onresult = (event) => {
      const cmd = event.results[0][0].transcript.toLowerCase().trim();
      if (cmd.includes('help') || cmd.includes('stuck')) {
        document.getElementById('emergencyModal') && bootstrap.Modal.getOrCreateInstance(document.getElementById('emergencyModal')).show();
      } else if (cmd.includes('map')) {
        window.location.href = '/index.html';
      } else if (cmd.includes('mobility') || cmd.includes('wheelchair')) {
        document.getElementById('filter-mobility')?.click();
      } else if (cmd.includes('vision') || cmd.includes('braille')) {
        document.getElementById('filter-vision')?.click();
      } else if (cmd.includes('hearing') || cmd.includes('quiet')) {
        document.getElementById('filter-hearing')?.click();
      } else {
        showToast('Command not recognized: ' + cmd);
      }
    };

    recognition.onerror = () => showToast('Voice recognition failed', 'error');
  },
};

document.addEventListener('DOMContentLoaded', () => A11y.init());
