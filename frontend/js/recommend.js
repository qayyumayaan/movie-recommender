let currentMovieId = null;
let currentMode = 'random'; // 'random' | 'smart'
let ratingCount = 0;

// LocalStorage key for one-time notification
const LS_KEY_SMART_UNLOCK = "notif_smart_unlocked";

function showAlert(message, type = 'info') {
  const alertEl = document.getElementById('alert');
  if (!alertEl) return;
  alertEl.className = `alert alert-${type}`;
  alertEl.textContent = message;
  alertEl.classList.remove('d-none');
}

function updateUnlockState() {
  const smartToggle = document.getElementById("mode-toggle");
  const smartUnlocked = ratingCount >= 10;
  smartToggle.disabled = !smartUnlocked;

  if (smartUnlocked && !localStorage.getItem(LS_KEY_SMART_UNLOCK)) {
    showAlert("Smart suggestion mode is now enabled!", "success");
    localStorage.setItem(LS_KEY_SMART_UNLOCK, "1");
  }
}

async function fetchCurrentUserOrRedirect() {
  try {
    return await apiFetch('/auth/me', { method: 'GET' });
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

function updateModeToggleUI() {
  const btn = document.getElementById('mode-toggle');
  if (!btn) return;

  if (currentMode === 'random') {
    btn.textContent = 'Random';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-outline-secondary');
  } else {
    btn.textContent = 'Smart';
    btn.classList.remove('btn-outline-secondary');
    btn.classList.add('btn-primary');
  }
}

async function loadNextMovie() {
  const titleEl = document.getElementById('movie-title');
  const statusText = document.getElementById('status-text');
  statusText.textContent = '';
  titleEl.textContent = 'Loading...';
  setButtonsEnabled(false);

  try {
    const movie = await apiFetch(`/movies/random?mode=${currentMode}`, {
      method: 'GET',
    });
    currentMovieId = movie.id;

    titleEl.textContent = movie.title;

    // Poster
    const posterEl = document.getElementById('movie-poster');
    if (movie.poster_path) {
      posterEl.src = `https://image.tmdb.org/t/p/w500/${movie.poster_path}`;
      posterEl.classList.remove("d-none");
    } else {
      posterEl.classList.add("d-none");
    }

    document.getElementById('movie-overview').textContent =
      movie.overview || "No description available.";

    let info = "";
    if (movie.startYear || movie.imdb_rating || movie.imdb_votes) {
      info =
        `The movie was released in <strong>${movie.startYear ?? "N/A"}</strong> `
        + `with an <strong>${movie.imdb_rating ?? "N/A"}</strong> on IMDB, `
        + `rated by <strong>${movie.imdb_votes ?? "N/A"}</strong> viewers.`;
    }

    document.getElementById('movie-info').innerHTML = info;

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
    ratingCount++;
    updateUnlockState();

    await loadNextMovie();
  } catch (err) {
    showAlert(err.data?.detail || err.message, 'danger');
  }
}

// ---- INIT ----

document.addEventListener('DOMContentLoaded', async () => {
  const user = await fetchCurrentUserOrRedirect();
  if (!user) return;

  // Get rating history count
  try {
    const history = await apiFetch('/movies/history', { method: 'GET' });
    ratingCount = history.length;
  } catch {
    ratingCount = 0;
  }

  updateUnlockState();

  // Rating buttons
  document.getElementById('btn-up').addEventListener('click', () => sendRating(true));
  document.getElementById('btn-down').addEventListener('click', () => sendRating(false));

  // Mode toggle
  const modeToggle = document.getElementById('mode-toggle');
  if (modeToggle) {
    modeToggle.addEventListener('click', async () => {
      currentMode = currentMode === 'random' ? 'smart' : 'random';
      updateModeToggleUI();
      await loadNextMovie();
    });
  }

  updateModeToggleUI();
  await loadNextMovie();
});
