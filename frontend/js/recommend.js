let currentMovieId = null;

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

function setButtonsEnabled(enabled) {
  document.getElementById('btn-up').disabled = !enabled;
  document.getElementById('btn-down').disabled = !enabled;
}

async function loadRandomMovie() {
  const titleEl = document.getElementById('movie-title');
  const statusText = document.getElementById('status-text');
  statusText.textContent = '';
  titleEl.textContent = 'Loading...';
  setButtonsEnabled(false);

  try {
    const movie = await apiFetch('/movies/random', { method: 'GET' });
    currentMovieId = movie.id;
    titleEl.textContent = movie.title;
    setButtonsEnabled(true);
  } catch (err) {
    if (err.status === 404) {
      titleEl.textContent = 'No more movies available.';
      statusText.textContent = 'You have rated all available movies.';
      setButtonsEnabled(false);
      return;
    }
    showAlert(err.data?.detail || err.message, 'danger');
    titleEl.textContent = 'Error loading movie.';
  }
}

async function sendRating(isUp) {
  if (!currentMovieId) return;
  const statusText = document.getElementById('status-text');

  try {
    await apiFetch('/movies/rate', {
      method: 'POST',
      body: JSON.stringify({ movie_id: currentMovieId, rating: isUp }),
    });
    statusText.textContent = 'Rating saved! Fetching next movie...';
    await loadRandomMovie();
  } catch (err) {
    showAlert(err.data?.detail || err.message, 'danger');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await fetchCurrentUserOrRedirect();
  if (!user) return;

  document.getElementById('btn-up').addEventListener('click', () => sendRating(true));
  document.getElementById('btn-down').addEventListener('click', () => sendRating(false));

  await loadRandomMovie();
});
