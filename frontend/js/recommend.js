let profile = null;
let currentMovie = null;
let currentMode = 'random'; // 'random' | 'smart'
let currentMovieIsFavorite = false;

function showAlert(message, type = 'info') {
  const alertEl = document.getElementById('alert');
  if (!alertEl) return;
  alertEl.className = `alert alert-${type}`;
  alertEl.textContent = message;
  alertEl.classList.remove('d-none');
}

function hideAlert() {
  const alertEl = document.getElementById('alert');
  if (!alertEl) return;
  alertEl.classList.add('d-none');
  alertEl.textContent = '';
}

function smartUnlocked() {
  return profile.history.length >= MovieStore.SMART_UNLOCK;
}

function updateUnlockState() {
  const toggleBtn = document.getElementById('mode-toggle');
  if (!toggleBtn) return;

  const unlocked = smartUnlocked();
  toggleBtn.disabled = !unlocked;
  toggleBtn.textContent = unlocked
    ? 'Toggle'
    : `Rate ${MovieStore.SMART_UNLOCK} movies to unlock Smart suggestions`;
  toggleBtn.classList.toggle('btn-primary', unlocked);
  toggleBtn.classList.toggle('btn-outline-secondary', !unlocked);
}

function setButtonsEnabled(enabled) {
  document.getElementById('btn-up').disabled = !enabled;
  document.getElementById('btn-down').disabled = !enabled;
  document.getElementById('btn-star').disabled = !enabled;
}

function updateModeToggleUI() {
  const label = document.getElementById('mode-label');
  if (label) label.textContent = currentMode === 'random' ? 'Random' : 'Smart';
}

function updateStarButtonUI() {
  const btn = document.getElementById('btn-star');
  if (!btn) return;
  btn.classList.toggle('btn-warning', currentMovieIsFavorite);
  btn.classList.toggle('btn-outline-warning', !currentMovieIsFavorite);
  btn.textContent = currentMovieIsFavorite ? '★ Favorited' : '☆ Favorite';
}

async function loadNextMovie() {
  const titleEl = document.getElementById('movie-title');
  titleEl.textContent = 'Loading...';
  setButtonsEnabled(false);

  try {
    const movie = await MovieStore.nextMovie(profile, currentMode);
    currentMovie = movie;
    currentMovieIsFavorite = false;
    updateStarButtonUI();

    if (!movie) {
      titleEl.textContent = 'No more movies available.';
      document.getElementById('status-text').textContent = 'You have rated all available movies.';
      document.getElementById('movie-poster').classList.add('d-none');
      document.getElementById('movie-overview').textContent = '';
      document.getElementById('movie-info').textContent = '';
      return;
    }

    titleEl.textContent = movie.title;

    const posterEl = document.getElementById('movie-poster');
    if (movie.poster_path) {
      posterEl.src = `https://image.tmdb.org/t/p/w500/${movie.poster_path}`;
      posterEl.alt = `${movie.title} poster`;
      posterEl.classList.remove('d-none');
    } else {
      posterEl.classList.add('d-none');
    }

    document.getElementById('movie-overview').textContent =
      movie.overview || 'No description available.';

    const info = document.getElementById('movie-info');
    info.textContent = '';
    if (movie.startYear || movie.imdb_rating || movie.imdb_votes) {
      const strong = (t) => { const s = document.createElement('strong'); s.textContent = t ?? 'N/A'; return s; };
      info.append(
        'The movie was released in ', strong(movie.startYear),
        ' with an ', strong(movie.imdb_rating), ' on IMDB, rated by ',
        strong(movie.imdb_votes?.toLocaleString()), ' viewers.',
      );
    }

    setButtonsEnabled(true);
  } catch (err) {
    showAlert(err.message, 'danger');
    titleEl.textContent = 'Error loading movie.';
  }
}

async function sendRating(isUp) {
  if (!currentMovie) return;
  MovieStore.rate(profile, currentMovie.slot, isUp, currentMovieIsFavorite);
  document.getElementById('status-text').textContent = 'Rating saved! Fetching next movie...';
  updateUnlockState();
  await loadNextMovie();
  document.getElementById('status-text').textContent = '';
}

// The current movie isn't rated yet, so the star is held until you rate it.
function toggleFavorite() {
  if (!currentMovie) return;
  currentMovieIsFavorite = !currentMovieIsFavorite;
  updateStarButtonUI();
  document.getElementById('status-text').textContent = currentMovieIsFavorite
    ? 'Will be added to favorites when you rate it.'
    : 'Removed from favorites.';
}

document.addEventListener('DOMContentLoaded', async () => {
  profile = MovieStore.requireProfile();
  if (!profile) return;

  currentMode = smartUnlocked() ? MovieStore.getMode() : 'random';
  updateUnlockState();
  updateModeToggleUI();

  document.getElementById('btn-up').addEventListener('click', () => sendRating(true));
  document.getElementById('btn-down').addEventListener('click', () => sendRating(false));
  document.getElementById('btn-star').addEventListener('click', toggleFavorite);

  document.getElementById('mode-toggle').addEventListener('click', async () => {
    currentMode = currentMode === 'random' ? 'smart' : 'random';
    MovieStore.setMode(currentMode);
    updateModeToggleUI();
    hideAlert();
    await loadNextMovie();
  });

  // Warm up the embeddings in the background so Smart mode is instant later.
  MovieStore.loadEmbeddings().catch(() => {});

  await loadNextMovie();
});
