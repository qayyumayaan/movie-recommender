/*
 * Client-side replacement for the old FastAPI backend.
 *
 *  - Profile lives in localStorage (up to MAX_HISTORY most recent ratings).
 *  - A 64-character base64url "profile code" restores your taste on any device.
 *  - Recommendations replicate the backend's SQL scoring in JavaScript.
 *
 * Profile code layout (384 bits = 48 bytes = 64 base64url chars, big-endian):
 *   [version: 4 bits]
 *   [26 entries x 14 bits: slot+1 (12 bits, 0 = empty) | liked (1) | favorite (1)]
 *   [CRC-16/CCITT-FALSE of the first 46 bytes: 16 bits]
 * Entries are ordered newest first. A "slot" is a movie's index in
 * data/movies.json, which never changes (see scripts/build_static_data.py).
 */
(function () {
  'use strict';

  const LS_PROFILE = 'mr_profile_v1';
  const LS_MODE = 'mr_mode';
  const MAX_HISTORY = 2048;   // most recent ratings kept on this device
  const LAST_RATINGS_N = 10;  // ratings used for the taste vector (backend default)
  const SMART_UNLOCK = 10;

  const CODE_VERSION = 1;
  const CODE_ENTRIES = 26;
  const CODE_BYTES = 48;
  const SLOT_BITS = 12;

  // ---------- localStorage (wrapped: may be unavailable) ----------
  function lsGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  }
  function lsRemove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }

  // ---------- profile ----------
  // history: [{ s: slot, r: liked(bool), f: favorite(bool), t: ms timestamp | null }], newest first
  function loadProfile() {
    const raw = lsGet(LS_PROFILE);
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      if (p && Array.isArray(p.history)) return p;
    } catch { /* fall through */ }
    return null;
  }

  function saveProfile(p) {
    p.history = p.history.slice(0, MAX_HISTORY);
    return lsSet(LS_PROFILE, JSON.stringify(p));
  }

  function newProfile() {
    const p = { history: [] };
    saveProfile(p);
    return p;
  }

  function clearProfile() { lsRemove(LS_PROFILE); }

  function rate(p, slot, liked, favorite) {
    const prev = p.history.find(h => h.s === slot);
    p.history = p.history.filter(h => h.s !== slot);
    p.history.unshift({ s: slot, r: !!liked, f: favorite ?? (prev ? prev.f : false), t: Date.now() });
    saveProfile(p);
  }

  function toggleFavorite(p, slot) {
    const h = p.history.find(x => x.s === slot);
    if (!h) return null;
    h.f = !h.f;
    saveProfile(p);
    return h.f;
  }

  // ---------- profile code ----------
  function crc16(bytes, len) {
    let crc = 0xffff;
    for (let i = 0; i < len; i++) {
      crc ^= bytes[i] << 8;
      for (let b = 0; b < 8; b++) {
        crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc;
  }

  function toBase64Url(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  class BitWriter {
    constructor(n) { this.bytes = new Uint8Array(n); this.pos = 0; }
    write(value, bits) {
      for (let i = bits - 1; i >= 0; i--) {
        if ((value >> i) & 1) this.bytes[this.pos >> 3] |= 0x80 >> (this.pos & 7);
        this.pos++;
      }
    }
  }

  class BitReader {
    constructor(bytes) { this.bytes = bytes; this.pos = 0; }
    read(bits) {
      let v = 0;
      for (let i = 0; i < bits; i++) {
        v = (v << 1) | ((this.bytes[this.pos >> 3] >> (7 - (this.pos & 7))) & 1);
        this.pos++;
      }
      return v;
    }
  }

  // Pick which history entries go into the code: the last N ratings (they drive
  // the taste vector), then favorites (always part of the taste vector), then
  // the most recent remaining ratings. Output keeps newest-first order.
  function selectCodeEntries(history) {
    const chosen = new Set();
    history.slice(0, LAST_RATINGS_N).forEach((_, i) => chosen.add(i));
    history.forEach((h, i) => { if (h.f && chosen.size < CODE_ENTRIES) chosen.add(i); });
    for (let i = 0; i < history.length && chosen.size < CODE_ENTRIES; i++) chosen.add(i);
    return [...chosen].sort((a, b) => a - b).map(i => history[i]);
  }

  function encodeCode(p) {
    const w = new BitWriter(CODE_BYTES);
    w.write(CODE_VERSION, 4);
    const entries = selectCodeEntries(p.history);
    for (let i = 0; i < CODE_ENTRIES; i++) {
      const e = entries[i];
      if (e) {
        w.write(e.s + 1, SLOT_BITS);
        w.write(e.r ? 1 : 0, 1);
        w.write(e.f ? 1 : 0, 1);
      } else {
        w.write(0, SLOT_BITS + 2);
      }
    }
    w.write(crc16(w.bytes, CODE_BYTES - 2), 16);
    return toBase64Url(w.bytes);
  }

  // Returns a profile, or throws an Error with a user-facing message.
  function decodeCode(code) {
    const clean = String(code || '').trim().replace(/\s+/g, '');
    if (!/^[A-Za-z0-9_-]{64}$/.test(clean)) {
      throw new Error('A profile code is exactly 64 characters (letters, digits, - and _).');
    }
    const bytes = fromBase64Url(clean);
    const r = new BitReader(bytes);
    const version = r.read(4);
    if (version !== CODE_VERSION) throw new Error('Unknown profile code version.');
    const stored = (bytes[CODE_BYTES - 2] << 8) | bytes[CODE_BYTES - 1];
    if (stored !== crc16(bytes, CODE_BYTES - 2)) {
      throw new Error('That code has a typo in it (checksum mismatch). Please paste it again.');
    }
    const history = [];
    const seen = new Set();
    for (let i = 0; i < CODE_ENTRIES; i++) {
      const slot1 = r.read(SLOT_BITS);
      const liked = r.read(1) === 1;
      const fav = r.read(1) === 1;
      if (slot1 === 0 || seen.has(slot1)) continue;
      seen.add(slot1);
      history.push({ s: slot1 - 1, r: liked, f: fav, t: null });
    }
    return { history };
  }

  // ---------- movie data ----------
  let moviesPromise = null;
  let embeddingsPromise = null;

  function loadMovies() {
    if (!moviesPromise) {
      moviesPromise = fetch('data/movies.json')
        .then(r => { if (!r.ok) throw new Error(`Failed to load movies (${r.status})`); return r.json(); })
        .then(d => ({
          dim: d.dim,
          movies: d.movies.map((m, slot) => m && ({
            slot, id: m[0], title: m[1], startYear: m[2], imdb_rating: m[3],
            imdb_votes: m[4], overview: m[5], poster_path: m[6],
          })),
        }));
    }
    return moviesPromise;
  }

  function loadEmbeddings() {
    if (!embeddingsPromise) {
      embeddingsPromise = Promise.all([
        loadMovies(),
        fetch('data/embeddings.bin').then(r => {
          if (!r.ok) throw new Error(`Failed to load embeddings (${r.status})`);
          return r.arrayBuffer();
        }),
      ]).then(([data, buf]) => {
        const emb = new Float32Array(buf);
        const n = data.movies.length;
        const norms = new Float32Array(n);
        for (let s = 0; s < n; s++) {
          let sum = 0;
          for (let i = 0, o = s * data.dim; i < data.dim; i++) sum += emb[o + i] * emb[o + i];
          norms[s] = Math.sqrt(sum);
        }
        return { emb, norms, dim: data.dim };
      });
    }
    return embeddingsPromise;
  }

  // ---------- recommender (ports of backend/app/routers/movie_routes.py) ----------
  function profileVector(p, E) {
    const weighted = [];
    for (const h of p.history.slice(0, LAST_RATINGS_N)) weighted.push([h.s, h.r ? 1 : -1]);
    for (const h of p.history) if (h.f) weighted.push([h.s, 1]);
    if (!weighted.length) return null;

    const agg = new Float64Array(E.dim);
    let total = 0;
    for (const [s, w] of weighted) {
      for (let i = 0, o = s * E.dim; i < E.dim; i++) agg[i] += E.emb[o + i] * w;
      total += Math.abs(w);
    }
    let norm = 0;
    for (let i = 0; i < E.dim; i++) { agg[i] /= total; norm += agg[i] * agg[i]; }
    norm = Math.sqrt(norm);
    return norm > 0 ? { vec: agg, norm } : null;
  }

  // Postgres log() is base 10.
  const popularityWeight = votes => 0.05 * Math.sqrt(Math.log10(votes + 1) / 7);
  const ratingWeight = rating => 0.05 * Math.sqrt(Math.exp(Math.log(5) * (rating - 5)) / 100) - 0.01;
  const recencyWeight = year => 0.0003 * Math.sqrt(Math.pow(1.09, year - 1920));

  function smartPick(p, movies, E, exclude) {
    const u = profileVector(p, E);
    if (!u) return null;
    let best = null;
    let bestScore = Infinity;
    for (const m of movies) {
      if (!m || exclude.has(m.slot)) continue;
      if (m.imdb_votes == null || m.imdb_rating == null || m.startYear == null) continue;
      const mn = E.norms[m.slot];
      if (!mn) continue;
      let dot = 0;
      for (let i = 0, o = m.slot * E.dim; i < E.dim; i++) dot += E.emb[o + i] * u.vec[i];
      const distance = 1 - dot / (mn * u.norm);
      const score = distance
        - 10 * (popularityWeight(m.imdb_votes) * ratingWeight(m.imdb_rating))
        - recencyWeight(m.startYear);
      if (score < bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  function randomPick(movies, exclude) {
    const pool = [];
    let total = 0;
    for (const m of movies) {
      if (!m || exclude.has(m.slot)) continue;
      if (!(m.imdb_votes > 1000) || m.imdb_rating == null) continue;
      const recency = m.startYear >= 2010 ? 1.3 : m.startYear >= 2000 ? 1.1 : 1.0;
      const w = Math.pow(m.imdb_votes + 1, 0.7) * Math.pow(m.imdb_rating / 10, 1.5) * recency;
      if (w > 0) { pool.push([m, w]); total += w; }
    }
    if (!pool.length) return null;
    let x = Math.random() * total;
    for (const [m, w] of pool) { x -= w; if (x <= 0) return m; }
    return pool[pool.length - 1][0];
  }

  async function nextMovie(p, mode) {
    const { movies } = await loadMovies();
    const exclude = new Set(p.history.map(h => h.s));
    let movie = null;
    if (mode === 'smart') movie = smartPick(p, movies, await loadEmbeddings(), exclude);
    if (!movie) movie = randomPick(movies, exclude);
    return movie;
  }

  // ---------- misc helpers ----------
  function getMode() { return lsGet(LS_MODE) === 'smart' ? 'smart' : 'random'; }
  function setMode(m) { lsSet(LS_MODE, m); }

  function resumeLink(code) {
    const url = new URL('index.html', window.location.href);
    url.hash = `code=${code}`;
    return url.toString();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  // Redirect to the welcome page when there is no profile on this device.
  function requireProfile() {
    const p = loadProfile();
    if (!p) window.location.replace('index.html');
    return p;
  }

  window.MovieStore = {
    MAX_HISTORY, LAST_RATINGS_N, SMART_UNLOCK, CODE_ENTRIES,
    loadProfile, saveProfile, newProfile, clearProfile, requireProfile,
    rate, toggleFavorite,
    encodeCode, decodeCode, resumeLink, copyText,
    loadMovies, loadEmbeddings, nextMovie, getMode, setMode,
  };
})();
