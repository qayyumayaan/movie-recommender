let currentMovieId = null;
let currentMode = 'random'; // 'random' | 'smart'
let researchVisible = false;
let tsneChart = null;

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
    setButtonsEnabled(true);

    // If research view is open, update the embedding plot too
    if (researchVisible) {
      await refreshTsnePlot();
    }
  } catch (err) {
    if (err.status === 404) {
      titleEl.textContent = 'No more movies available.';
      statusText.textContent = 'You have rated all available movies.';
      setButtonsEnabled(false);

      if (researchVisible) {
        await refreshTsnePlot();
      }
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

    // After rating, update both the recommendation and (if visible) the t-SNE plot
    await loadNextMovie();
    if (researchVisible) {
      await refreshTsnePlot();
    }
  } catch (err) {
    showAlert(err.data?.detail || err.message, 'danger');
  }
}

// ---- Research View (t-SNE) ----

async function fetchTsneSpace() {
  return apiFetch('/movies/space', { method: 'GET' });
}

function buildTsneDataset(space) {
  const liked = [];
  const disliked = [];
  const unseen = [];

  for (const p of space.points) {
    const basePoint = {
      x: p.x,
      y: p.y,
      movieTitle: p.title,
    };
    if (p.rating === true) {
      liked.push(basePoint);
    } else if (p.rating === false) {
      disliked.push(basePoint);
    } else {
      unseen.push(basePoint);
    }
  }

  let userDataset = null;
  if (space.user_point) {
    userDataset = {
      label: 'User preference',
      data: [{ x: space.user_point.x, y: space.user_point.y }],
      pointBackgroundColor: 'black',
      pointBorderColor: 'black',
      pointRadius: 7,
      pointStyle: 'triangle',
      showLine: false,
    };
  }

  return { liked, disliked, unseen, userDataset };
}

function createOrUpdateTsneChart(space) {
  const ctx = document.getElementById('tsne-canvas').getContext('2d');
  const { liked, disliked, unseen, userDataset } = buildTsneDataset(space);

  const datasets = [
    {
      label: 'Unseen movies',
      data: unseen,
      pointBackgroundColor: 'rgba(128,128,128,0.7)',
      pointBorderColor: 'rgba(80,80,80,0.9)',
      pointRadius: 3,
      showLine: false,
    },
    {
      label: 'Liked movies',
      data: liked,
      pointBackgroundColor: 'rgba(0, 180, 0, 0.85)',
      pointBorderColor: 'rgba(0, 120, 0, 1)',
      pointRadius: 4,
      showLine: false,
    },
    {
      label: 'Disliked movies',
      data: disliked,
      pointBackgroundColor: 'rgba(220, 0, 0, 0.85)',
      pointBorderColor: 'rgba(160, 0, 0, 1)',
      pointRadius: 4,
      showLine: false,
    },
  ];

  if (userDataset) {
    datasets.push(userDataset);
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const point = ctx.raw;
            const label = ctx.dataset.label || '';
            if (point && point.movieTitle) {
              return `${label ? label + ': ' : ''}${point.movieTitle}`;
            }
            return label || '';
          },
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        title: {
          display: true,
          text: 't-SNE dimension 1',
        },
      },
      y: {
        type: 'linear',
        title: {
          display: true,
          text: 't-SNE dimension 2',
        },
      },
    },
  };

  if (tsneChart) {
    tsneChart.data.datasets = datasets;
    tsneChart.update();
  } else {
    tsneChart = new Chart(ctx, {
      type: 'scatter',
      data: { datasets },
      options,
    });
  }
}

async function refreshTsnePlot() {
  try {
    const space = await fetchTsneSpace();
    if (!space.points || space.points.length === 0) return;
    createOrUpdateTsneChart(space);
  } catch (err) {
    console.error('Failed to load t-SNE space:', err);
  }
}

// ---- init ----

document.addEventListener('DOMContentLoaded', async () => {
  const user = await fetchCurrentUserOrRedirect();
  if (!user) return;

  // rating buttons
  document.getElementById('btn-up').addEventListener('click', () => sendRating(true));
  document.getElementById('btn-down').addEventListener('click', () => sendRating(false));

  // mode toggle (random/smart)
  const modeToggle = document.getElementById('mode-toggle');
  if (modeToggle) {
    modeToggle.addEventListener('click', async () => {
      currentMode = currentMode === 'random' ? 'smart' : 'random';
      updateModeToggleUI();
      await loadNextMovie();
    });
  }
  updateModeToggleUI();

  // research toggle
  const researchToggle = document.getElementById('btn-research-toggle');
  const researchPanel = document.getElementById('research-panel');

  if (researchToggle && researchPanel) {
    researchToggle.addEventListener('click', async () => {
      researchVisible = !researchVisible;
      if (researchVisible) {
        researchPanel.classList.remove('d-none');
        researchToggle.textContent = 'Hide Research View';
        await refreshTsnePlot();
      } else {
        researchPanel.classList.add('d-none');
        researchToggle.textContent = 'Show Research View';
      }
    });
  }

  await loadNextMovie();
});
