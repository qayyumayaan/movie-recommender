let profile = null;
let movies = [];

function showAlert(message, type = 'info') {
  const alertEl = document.getElementById('alert');
  if (!alertEl) return;
  alertEl.className = `alert alert-${type}`;
  alertEl.textContent = message;
  alertEl.classList.remove('d-none');
}

function renderCode() {
  document.getElementById('profile-code').value = MovieStore.encodeCode(profile);

  const favs = profile.history.filter(h => h.f).length;
  const notes = [];
  if (profile.history.length > MovieStore.CODE_ENTRIES) {
    notes.push(`The code holds your ${MovieStore.LAST_RATINGS_N} latest ratings plus favorites (${MovieStore.CODE_ENTRIES} movies in total). That's everything the recommender needs. Your full history of up to ${MovieStore.MAX_HISTORY} movies stays on this device.`);
  }
  if (favs > MovieStore.CODE_ENTRIES - MovieStore.LAST_RATINGS_N) {
    notes.push(`You have ${favs} favorites. Only the newest ${MovieStore.CODE_ENTRIES - MovieStore.LAST_RATINGS_N} or so fit in the code.`);
  }
  document.getElementById('code-note').textContent = notes.join(' ');
}

async function copy(text) {
  const status = document.getElementById('copy-status');
  const ok = await MovieStore.copyText(text);
  status.textContent = ok ? 'Copied!' : 'Copy failed. Select the code and copy it manually.';
  status.className = `small ${ok ? 'text-success' : 'text-danger'}`;
  setTimeout(() => { status.textContent = ''; }, 2500);
}

function setFavButton(btn, isFav) {
  btn.className = isFav ? 'btn btn-sm btn-warning' : 'btn btn-sm btn-outline-warning';
  btn.textContent = isFav ? '★' : '☆';
  btn.title = isFav ? 'Unfavorite' : 'Favorite';
}

function loadHistory() {
  const tbody = document.getElementById('history-body');
  const summaryEl = document.getElementById('rating-summary');
  tbody.innerHTML = '';

  const history = profile.history;
  const total = history.length;
  const ups = history.filter(h => h.r).length;
  summaryEl.textContent =
    `You have rated ${total} movies in total, rating ${ups} movies Up and ${total - ups} movies Down.`;

  if (!total) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = 'No rated movies yet.';
    cell.classList.add('text-muted');
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  let counter = total; // latest movie gets the largest index
  for (const item of history) {
    const row = document.createElement('tr');

    const idxTd = document.createElement('td');
    idxTd.textContent = counter--;

    const titleTd = document.createElement('td');
    titleTd.textContent = movies[item.s]?.title ?? `(movie no longer available)`;

    const ratingTd = document.createElement('td');
    ratingTd.innerHTML = item.r
      ? '<span class="text-success">👍 Up</span>'
      : '<span class="text-danger">👎 Down</span>';

    const favTd = document.createElement('td');
    const favBtn = document.createElement('button');
    setFavButton(favBtn, item.f);
    favBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isFav = MovieStore.toggleFavorite(profile, item.s);
      setFavButton(favBtn, !!isFav);
      renderCode();
    });
    favTd.appendChild(favBtn);

    const dateTd = document.createElement('td');
    dateTd.textContent = item.t ? new Date(item.t).toLocaleString() : 'Restored from code';
    if (!item.t) dateTd.classList.add('text-muted');

    row.append(idxTd, titleTd, ratingTd, favTd, dateTd);
    tbody.appendChild(row);
  }
}

function resetHistory() {
  if (!confirm('Reset your entire rating history? Your current profile code will stop matching this device.')) return;
  profile = MovieStore.newProfile();
  showAlert('History reset.', 'warning');
  renderCode();
  loadHistory();
}

function logout() {
  if (!confirm('Log out of this device? Your history here will be erased. Make sure you have copied your profile code first.')) return;
  MovieStore.clearProfile();
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  profile = MovieStore.requireProfile();
  if (!profile) return;

  document.getElementById('btn-reset').addEventListener('click', resetHistory);
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-copy-code').addEventListener('click',
    () => copy(MovieStore.encodeCode(profile)));
  document.getElementById('btn-copy-link').addEventListener('click',
    () => copy(MovieStore.resumeLink(MovieStore.encodeCode(profile))));

  renderCode();
  try {
    movies = (await MovieStore.loadMovies()).movies;
  } catch (err) {
    showAlert(err.message, 'danger');
  }
  loadHistory();
});
