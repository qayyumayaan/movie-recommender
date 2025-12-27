function showAlert(message, type = 'danger') {
  const alertEl = document.getElementById('alert');
  if (!alertEl) return;
  alertEl.className = `alert alert-${type}`;
  alertEl.textContent = message;
  alertEl.classList.remove('d-none');
}

function setLoginStatus(isLoading) {
  const el = document.getElementById('login-status');
  if (!el) return;
  el.classList.toggle('d-none', !isLoading);
}


async function handleRegister() {
  const email = document.getElementById('email').value.trim();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();

  if (!email || !username || !password) {
    showAlert('Please fill in all fields.');
    return;
  }

  try {
    setLoginStatus(true); 
    await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, password }),
    });
    // registration also logs in; go to dashboard
    window.location.href = 'dashboard.html';
  } catch (err) {
    showAlert(err.data?.detail || err.message);
  }
}

async function handleLogin() {
  const email = document.getElementById('email').value.trim();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();

  if (!password || (!email && !username)) {
    showAlert('Please provide username/email and password.');
    return;
  }

  const username_or_email = email || username;

  try {
    setLoginStatus(true); 
    await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username_or_email, password }),
    });
    window.location.href = 'dashboard.html';
  } catch (err) {
    setLoginStatus(false);
    showAlert(err.data?.detail || err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btnLogin = document.getElementById('btn-login');
  const btnRegister = document.getElementById('btn-register');

  if (btnLogin) btnLogin.addEventListener('click', handleLogin);
  if (btnRegister) btnRegister.addEventListener('click', handleRegister);
});
