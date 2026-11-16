function showAlert(message, type = 'danger') {
  const alertEl = document.getElementById('alert');
  if (!alertEl) return;
  alertEl.className = `alert alert-${type}`;
  alertEl.textContent = message;
  alertEl.classList.remove('d-none');
}

function handleResume(e) {
  e.preventDefault();
  const code = document.getElementById('code').value;
  try {
    const profile = MovieStore.decodeCode(code);
    if (!MovieStore.saveProfile(profile)) {
      showAlert('This browser is blocking local storage, so your profile cannot be saved here.');
      return;
    }
    window.location.href = 'recommend.html';
  } catch (err) {
    showAlert(err.message);
  }
}

function handleNew() {
  const existing = MovieStore.loadProfile();
  if (existing && existing.history.length &&
      !confirm('Start fresh? This erases the history saved on this device. Copy your profile code from the Dashboard first if you want to keep it.')) {
    return;
  }
  if (!MovieStore.newProfile()) {
    showAlert('This browser is blocking local storage, so your profile cannot be saved here.');
    return;
  }
  window.location.href = 'recommend.html';
}

document.addEventListener('DOMContentLoaded', () => {
  const existing = MovieStore.loadProfile();
  if (existing) {
    document.getElementById('continue-count').textContent = existing.history.length;
    document.getElementById('continue-block').classList.remove('d-none');
  }

  const codeInput = document.getElementById('code');
  codeInput.addEventListener('input', () => {
    const show = !!(existing && existing.history.length && codeInput.value.trim());
    document.getElementById('resume-warning').classList.toggle('d-none', !show);
  });

  // Resume links look like index.html#code=XXXX
  const match = window.location.hash.match(/code=([A-Za-z0-9_-]+)/);
  if (match) {
    codeInput.value = match[1];
    codeInput.dispatchEvent(new Event('input'));
    history.replaceState(null, '', window.location.pathname);
  }

  document.getElementById('resume-form').addEventListener('submit', handleResume);
  document.getElementById('btn-new').addEventListener('click', handleNew);
});
