// src/api/client.js
// Central API client for all backend communication.
// All fetch calls go through here — handles errors, run polling, WS reconnect.

const BASE = (import.meta.env.VITE_API_URL || '') + '/api';  // proxied by vite to http://localhost:8080/api

// ─── API key helper ───────────────────────────────────────────────────────────
export function getApiKey() {
  return localStorage.getItem('vidhi_api_key') || '';
}

export function setApiKey(key) {
  if (key) localStorage.setItem('vidhi_api_key', key);
  else localStorage.removeItem('vidhi_api_key');
}

export async function autoProvisionApiKey(userId) {
  if (getApiKey()) return getApiKey();
  try {
    const res = await fetch(BASE + '/apikey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId })
    });
    if (res.ok) {
      const data = await res.json();
      setApiKey(data.api_key);
      return data.api_key;
    }
  } catch (e) {
    console.warn("[AUTH] Auto-provision failed:", e);
  }
  return null;
}

// ─── REST helpers ─────────────────────────────────────────────────────────────
async function post(path, body) {
  const key = getApiKey();
  const res = await fetch(BASE + path, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'X-API-Key': key } : {}),
    },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function get(path) {
  const key = getApiKey();
  const res = await fetch(BASE + path, {
    headers: key ? { 'X-API-Key': key } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Health check ─────────────────────────────────────────────────────────────
// Returns true if backend is reachable and healthy, false otherwise.
// IMPORTANT: must return a plain boolean — objects are always truthy in JS.
export async function checkBackendHealth() {
  try {
    const data = await get('/health');
    // Accept 'ok', healthy DB, or any successful response
    return !!(data && (data.status === 'ok' || data.db === 'ok' || data.redis === 'ok'));
  } catch (_e) {
    return false;
  }
}

// ─── Submit code for forge pipeline + GM execution ────────────────────────────
// Returns { run_id, status, message }
export async function submitCode(code, userId = 'anonymous', roundId = 'round1', isPractice = false, botConfig = '') {
  const form = new FormData();
  const blob = new Blob([code], { type: 'text/x-python' });
  form.append('code',    blob, 'trader.py');
  form.append('user_id', userId);
  form.append('round_id', roundId);
  form.append('bot_config', botConfig); // Step 3: Send bot string config
  if (isPractice) form.append('is_practice', 'true');

  const key = getApiKey();
  const res = await fetch(BASE + '/submit', {
    method: 'POST',
    body:   form,
    headers: key ? { 'X-API-Key': key } : {},
    // Note: do NOT set Content-Type header — browser sets it with boundary for multipart
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401 || err.error?.includes('invalid or expired')) {
      setApiKey(null); // Clear the broken/expired key so auto-provision runs next time
    }
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Poll run status until complete/error (max 10min) ─────────────────────────
// Calls onProgress({ status, pnl, pnlPct, ... }) on each poll.
export async function pollRunUntilDone(runId, onProgress, intervalMs = 2000) {
  const maxWaitMs = 10 * 60 * 1000;
  const start     = Date.now();
  const TERMINAL  = new Set(['complete', 'error', 'tle']);

  while (Date.now() - start < maxWaitMs) {
    try {
      const run = await get(`/runs/${runId}`);
      if (typeof onProgress === 'function') onProgress(run);
      if (TERMINAL.has(run.status)) return run;
    } catch (e) {
      console.warn('[poll] error fetching run:', e.message);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Run polling timed out after 10 minutes');
}

export async function downloadRunLog(runId) {
  const key = getApiKey();
  const res = await fetch(BASE + `/runs/${runId}/execution-log`, {
    headers: key ? { 'X-API-Key': key } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${runId}.log`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export async function downloadRunCode(runId) {
  const key = getApiKey();
  const res = await fetch(BASE + `/runs/${runId}/code`, {
    headers: key ? { 'X-API-Key': key } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${runId}.py`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

// ─── Contests & Identity ──────────────────────────────────────────────────────
export async function fetchContests() {
  return get('/contests');
}

export async function registerStudent(userId, displayName, teamName) {
  return post('/contestants', {
    user_id: userId,
    display_name: displayName,
    team_name: teamName
  });
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
export async function fetchLeaderboard() {
  return get('/leaderboard');
}

// ─── WebSocket telemetry connection ───────────────────────────────────────────
// Returns a { close() } handle. onMessage called with parsed JSON.
export function connectTelemetryWS(onMessage, onConnect, onDisconnect) {
  // Use the same base URL for WebSocket as for REST
  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8080';
  const url = new URL(apiBase);
  const WS_URL = url.protocol === 'https:'
    ? 'wss://' + url.host + '/ws/telemetry'
    : 'ws://'  + url.host + '/ws/telemetry';

  let ws      = null;
  let closed  = false;
  let retries = 0;

  function connect() {
    if (closed) return;
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      retries = 0;
      console.log('[WS] Telemetry connected');
      if (onConnect) onConnect();
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onMessage(data);
      } catch (_e) {}
    };

    ws.onclose = () => {
      if (closed) return;
      console.log('[WS] Disconnected — retrying in', Math.min(30, 2 ** retries), 's');
      if (onDisconnect) onDisconnect();
      const delay = Math.min(30_000, 1_000 * 2 ** retries++);
      setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();
  }

  connect();

  return {
    close() {
      closed = true;
      if (ws) ws.close();
    },
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };
}

// ─── Contest Creator Endpoints ───────────────────────────────────────────────

export async function uploadRoundDataset(roundId, file, isFinal = false) {
  const endpoint = isFinal ? `/rounds/${roundId}/final-dataset` : `/rounds/${roundId}/dataset`;
  const form = new FormData();
  form.append('dataset', file);
  
  const key = getApiKey();
  const res = await fetch(BASE + endpoint, {
    method: 'POST',
    body: form,
    headers: key ? { 'X-API-Key': key } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function triggerFinalEvaluation(roundId) {
  return post(`/rounds/${roundId}/final-eval`, {});
}
