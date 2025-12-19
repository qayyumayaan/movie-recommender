const API_BASE_URL = '/api';

async function apiFetch(path, options = {}) {
  const opts = {
    credentials: 'include', // send cookies
    ...options,
  };

  // ensure JSON headers if we send a body
  if (opts.body && !opts.headers) {
    opts.headers = { 'Content-Type': 'application/json' };
  } else if (opts.body && opts.headers && !opts.headers['Content-Type']) {
    opts.headers['Content-Type'] = 'application/json';
  }

  const resp = await fetch(`${API_BASE_URL}${path}`, opts);

  let data = null;
  const contentType = resp.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    data = await resp.json();
  }

  if (!resp.ok) {
    const error = new Error(data?.detail || `Request failed with ${resp.status}`);
    error.status = resp.status;
    error.data = data;
    throw error;
  }

  return data;
}

window.apiFetch = apiFetch;

