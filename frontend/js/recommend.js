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
  } catch (err) {
    showAlert(err.data?.detail || err.message, 'danger');
  }
}

// Research View

async function fetchTsneSpace() {
  return apiFetch('/movies/space', { method: 'GET' });
}

async function buildTsneDataset(space, influence) {
  // const influence = await fetchInfluenceForCurrentMovie();
  const influentialIds = influence.map(i => i.movie_id);
  updateInfluenceSidebar(influence);

  const liked = [];
  const disliked = [];
  const unseen = [];
  const influentialPoints = [];
  let currentMoviePoint = null;

  for (const p of space.points) {
    const basePoint = {
      x: p.x,
      y: p.y,
      movieTitle: p.title
    };

    // Check if this point is the current movie
    if (p.id === currentMovieId) {
      currentMoviePoint = basePoint;
      continue;
    }

    if (influentialIds.includes(p.id)) {
      influentialPoints.push({ ...basePoint, rating: p.rating });
      continue;
    }


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

  let currentMovieDataset = null;
  if (currentMoviePoint) {
    currentMovieDataset = {
      label: 'Current movie',
      data: [currentMoviePoint],
      pointBackgroundColor: 'yellow',
      pointBorderColor: 'orange',
      pointRadius: 8,
      pointStyle: 'circle',
      showLine: false,
    };
  }

  return { liked, disliked, unseen, influentialPoints, userDataset, currentMovieDataset };
}

async function createOrUpdateTsneChart(space, influence) {
  const ctx = document.getElementById('tsne-canvas').getContext('2d');
  const { liked, disliked, unseen, influentialPoints, userDataset, currentMovieDataset } = await buildTsneDataset(space, influence);


  // Compute preference cluster circle
  let prefCircle = null;

  if (influence && influence.length > 0) {
    const inflCoords = [];
    for (const item of influence) {
      const pt = space.points.find(p => p.id === item.movie_id);
      if (pt) inflCoords.push([pt.x, pt.y]);
    }

    if (inflCoords.length > 0) {
      const cx = inflCoords.reduce((a, p) => a + p[0], 0) / inflCoords.length;
      const cy = inflCoords.reduce((a, p) => a + p[1], 0) / inflCoords.length;

      // average distance from centroid
      const radius =
        inflCoords.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cy), 0) /
        inflCoords.length;

      prefCircle = { cx, cy, radius: radius * 1.3 }; // expand slightly for looks
    }
  }

  const preferenceCirclePlugin = {
    id: 'preferenceCircle',
    afterDraw(chart, args, opts) {
      if (!opts.circle) return;

      const { ctx, chartArea: { left, right, top, bottom } } = chart;

      const xScale = chart.scales.x;
      const yScale = chart.scales.y;

      const cx = xScale.getPixelForValue(opts.circle.cx);
      const cy = yScale.getPixelForValue(opts.circle.cy);
      const r = (xScale.getPixelForValue(opts.circle.cx + opts.circle.radius) - cx);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, Math.abs(r), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);   // dotted outline
      ctx.stroke();

      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)'; // subtle fill
      ctx.fill();
      ctx.restore();
    }
  };



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
    {
      label: 'Influential movies',
      data: influentialPoints,
      pointRadius: 8,  // bigger circles

      // color depends on rating type
      pointBackgroundColor: (ctx) => {
        const r = ctx.raw.rating;
        if (r === true) return 'rgba(0, 180, 0, 1)';      // liked = green
        if (r === false) return 'rgba(220, 0, 0, 1)';     // disliked = red
        return 'rgba(128, 128, 128, 0.8)';                // unseen fallback
      },
      pointBorderColor: (ctx) => {
        const r = ctx.raw.rating;
        if (r === true) return 'rgba(0, 120, 0, 1)';
        if (r === false) return 'rgba(160, 0, 0, 1)';
        return 'rgba(80, 80, 80, 1)';
      },

      showLine: false,
    }


  ];

  if (currentMovieDataset) {
    datasets.push(currentMovieDataset);
  }

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
      preferenceCircle: {
        circle: prefCircle
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
          text: 'UMAP dimension 1',
        },
      },
      y: {
        type: 'linear',
        title: {
          display: true,
          text: 'UMAP dimension 2',
        },
      },
    },
  };

  if (tsneChart) {
    tsneChart.data.datasets = datasets;
    tsneChart.options.plugins.preferenceCircle.circle = prefCircle;
    tsneChart.update();
  } else {
    tsneChart = new Chart(ctx, {
      type: 'scatter',
      data: { datasets },
      options,
      plugins: [preferenceCirclePlugin]
    });
  }
}

async function refreshTsnePlot() {
  try {
    const space = await fetchTsneSpace();
    if (!space.points || space.points.length === 0) return;
    const influence = await fetchInfluenceForCurrentMovie();
    await createOrUpdateTsneChart(space, influence);
  } catch (err) {
    console.error('Failed to load UMAP space:', err);
  }
}

async function fetchInfluenceForCurrentMovie() {
  if (!currentMovieId) return [];

  try {
    return await apiFetch(`/movies/influence?movie_id=${currentMovieId}`, { method: "GET" });
  } catch (err) {
    console.error("Influence fetch failed", err);
    return [];
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

function updateInfluenceSidebar(influence) {
  const panel = document.getElementById("influence-panel");
  const list = document.getElementById("influence-list");

  if (!influence || influence.length === 0) {
    panel.classList.add("d-none");
    return;
  }

  panel.classList.remove("d-none");
  list.innerHTML = "";

  for (const item of influence) {
    const li = document.createElement("li");
    li.className = "list-group-item d-flex justify-content-between align-items-center";

    const sign = item.influence >= 0 ? "👍" : "👎";
    const magnitude = Math.abs(item.influence).toFixed(3);

    li.innerHTML = `
      <span>${item.movie_title}</span>
      <span class="badge bg-${item.influence >= 0 ? "success" : "danger"}">
        ${sign} ${magnitude}
      </span>
    `;
    list.appendChild(li);
  }
}
