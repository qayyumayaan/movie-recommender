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
  const summaryEl = document.getElementById('rating-summary');
  tbody.innerHTML = '';

  const history = await apiFetch('/movies/history', { method: 'GET' });

  // If there's a summary element on the page, we will update it.
  const hasSummary = !!summaryEl;

  // Empty history
  if (!history.length) {
    if (hasSummary) {
      summaryEl.textContent = 'You have rated 0 movies in total, rating 0 movies Up and 0 movies Down.';
    }

    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5; // 4 columns: #, Movie, Rating, Rated At
    cell.textContent = 'No rated movies yet.';
    cell.classList.add('text-muted');
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  // Compute statistics
  const total = history.length;

  // Treat any truthy rating as "Up",
  // since you're already doing `item.rating ? 'Up' : 'Down'`
  const ups = history.filter(h => !!h.rating).length;
  const downs = total - ups;

  if (hasSummary) {
    summaryEl.textContent =
      `You have rated ${total} movies in total, rating ${ups} movies Up and ${downs} movies Down.`;
  }

  // Ensure chronological order: latest first, highest number
  history.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  let counter = total; // Latest movie gets the largest index

  for (const item of history) {
    const row = document.createElement('tr');

    // Number column (chronological index)
    const idxTd = document.createElement('td');
    idxTd.textContent = counter--;

    // Movie title
    const titleTd = document.createElement('td');
    titleTd.textContent = item.movie_title;

    // Rating
    const ratingTd = document.createElement('td');
    ratingTd.innerHTML = item.rating
      ? '<span class="text-success">👍 Up</span>'
      : '<span class="text-danger">👎 Down</span>';

    // Favorite
    const favTd = document.createElement('td');
    const favBtn = document.createElement('button');

    favBtn.className = item.is_favorite
      ? 'btn btn-sm btn-warning'
      : 'btn btn-sm btn-outline-warning';

    favBtn.textContent = item.is_favorite ? '★' : '☆';
    favBtn.title = item.is_favorite ? 'Unfavorite' : 'Favorite';

    favBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const res = await apiFetch('/movies/favorite/toggle', {
          method: 'POST',
          body: JSON.stringify({ movie_id: item.movie_id }),
        });

        item.is_favorite = !!res.is_favorite;

        favBtn.className = item.is_favorite
          ? 'btn btn-sm btn-warning'
          : 'btn btn-sm btn-outline-warning';
        favBtn.textContent = item.is_favorite ? '★' : '☆';
        favBtn.title = item.is_favorite ? 'Unfavorite' : 'Favorite';
      } catch (err) {
        showAlert(err.data?.detail || err.message, 'danger');
      }
    });

    favTd.appendChild(favBtn);


    // Date
    const dateTd = document.createElement('td');
    const d = new Date(item.created_at);
    dateTd.textContent = d.toLocaleString();

    row.appendChild(idxTd);
    row.appendChild(titleTd);
    row.appendChild(ratingTd);
    row.appendChild(favTd);
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
