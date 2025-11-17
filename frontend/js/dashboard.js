function showAlert(message, type = 'info') {
  const alertEl = document.getElementById('alert');
  if (!alertEl) return;
  alertEl.className = `alert alert-${type}`;
  alertEl.textContent = message;
  alertEl.classList.remove('d-none');
}

async function fetchCurrentUserOrRedirect() {
  try {
    const user = await apiFetch('/auth/me', { method: 'GET' });
    return user;
  } catch (err) {
    if (err.status === 401) {
      window.location.href = 'login.html';
      return null;
    }
    throw err;
  }
}

async function loadHistory() {
  const tbody = document.getElementById('history-body');
  tbody.innerHTML = '';

  const history = await apiFetch('/movies/history', { method: 'GET' });

  if (!history.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No rated movies yet.';
    cell.classList.add('text-muted');
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  for (const item of history) {
    const row = document.createElement('tr');

    const titleTd = document.createElement('td');
    titleTd.textContent = item.movie_title;

    const ratingTd = document.createElement('td');
    ratingTd.innerHTML = item.rating
      ? '<span class="text-success">👍 Up</span>'
      : '<span class="text-danger">👎 Down</span>';

    const dateTd = document.createElement('td');
    const d = new Date(item.created_at);
    dateTd.textContent = d.toLocaleString();

    row.appendChild(titleTd);
    row.appendChild(ratingTd);
    row.appendChild(dateTd);

    tbody.appendChild(row);
  }
}

async function resetHistory() {
  if (!confirm('Reset your entire rating history?')) return;
  await apiFetch('/movies/history/reset', { method: 'POST' });
  showAlert('History reset.', 'warning');
  await loadHistory();
}

async function logout() {
  await apiFetch('/auth/logout', { method: 'POST' });
  window.location.href = 'login.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await fetchCurrentUserOrRedirect();
  if (!user) return;

  // Show user info
  const userInfo = document.getElementById('user-info');
  userInfo.textContent = `${user.username} (${user.email})`;

  document.getElementById('btn-reset').addEventListener('click', resetHistory);
  document.getElementById('btn-logout').addEventListener('click', logout);

  await loadHistory();
});
