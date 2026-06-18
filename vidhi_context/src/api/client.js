// src/api/client.js
// Central API client for all backend communication.
// All fetch calls go through here — handles errors, run polling, WS reconnect.

const LOCAL_BASE  = (import.meta.env.VITE_API_URL       || 'http://localhost:8080') + '/api';
const CLOUD_BASE  = (import.meta.env.VITE_CLOUD_API_URL || '') + '/api';
const CLOUD_WS    =  import.meta.env.VITE_CLOUD_WS_URL  || '';

// ─── API key helper ───────────────────────────────────────────────────────────
export function getApiKey() {
  return localStorage.getItem('vidhi_api_key') || '';
}

export function setApiKey(key) {
  if (key) localStorage.setItem('vidhi_api_key', key);
  else localStorage.removeItem('vidhi_api_key');
}

export async function autoProvisionApiKey(userId, customBaseUrl = null) {
  if (getApiKey()) return getApiKey();
  const base = customBaseUrl || LOCAL_BASE;
  try {
    const res = await fetch(base + '/apikey', {
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
    console.warn('[AUTH] Auto-provision failed:', e);
  }
  return null;
}

// ─── REST helpers ─────────────────────────────────────────────────────────────
async function post(path, body, customBaseUrl = null) {
  const key = getApiKey();
  const base = customBaseUrl || LOCAL_BASE;
  const res = await fetch(base + path, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'X-API-Key': key } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function get(path, customBaseUrl = null) {
  const key = getApiKey();
  const base = customBaseUrl || LOCAL_BASE;
  const res = await fetch(base + path, {
    headers: key ? { 'X-API-Key': key } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Health checks ────────────────────────────────────────────────────────────
// Returns true if the local backend (localhost) is reachable.
export async function checkBackendHealth() {
  try {
    const data = await get('/health', LOCAL_BASE);
    return !!(data && (data.status === 'ok' || data.db === 'ok' || data.redis === 'ok'));
  } catch (_e) {
    return false;
  }
}

// Returns true if the AWS cloud backend is reachable.
export async function checkCloudHealth() {
  if (!CLOUD_BASE || CLOUD_BASE === '/api') return false;
  try {
    const data = await get('/health', CLOUD_BASE);
    return !!(data && (data.status === 'ok' || data.db === 'ok' || data.redis === 'ok'));
  } catch (_e) {
    return false;
  }
}

// ─── Submit code for forge pipeline + GM execution ────────────────────────────
// Returns { run_id, status, message }
export async function submitCode(code, userId = 'anonymous', roundId = 'round1', isPractice = false, botConfig = '', customBaseUrl = null) {
  const form = new FormData();
  const blob = new Blob([code], { type: 'text/x-python' });
  form.append('code',       blob, 'trader.py');
  form.append('user_id',    userId);
  form.append('round_id',   roundId);
  form.append('bot_config', botConfig);
  if (isPractice) form.append('is_practice', 'true');

  const key = getApiKey();
  const base = customBaseUrl || LOCAL_BASE;
  const res = await fetch(base + '/submit', {
    method: 'POST',
    body:   form,
    headers: key ? { 'X-API-Key': key } : {},
    // Note: do NOT set Content-Type — browser sets it with boundary for multipart
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401 || err.error?.includes('invalid or expired')) {
      setApiKey(null);
    }
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Poll run status until complete/error (max 10min) ─────────────────────────
export async function pollRunUntilDone(runId, onProgress, customBaseUrl = null, intervalMs = 2000) {
  const maxWaitMs = 10 * 60 * 1000;
  const start     = Date.now();
  const TERMINAL  = new Set(['complete', 'error', 'tle']);
  const base      = customBaseUrl || LOCAL_BASE;

  while (Date.now() - start < maxWaitMs) {
    try {
      const run = await get(`/runs/${runId}`, base);
      if (typeof onProgress === 'function') onProgress(run);
      if (TERMINAL.has(run.status)) return run;
    } catch (e) {
      console.warn('[poll] error fetching run:', e.message);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Run polling timed out after 10 minutes');
}

// ─── Download helpers ─────────────────────────────────────────────────────────
export async function downloadRunLog(runId, customBaseUrl = null) {
  const key = getApiKey();
  const base = customBaseUrl || LOCAL_BASE;
  const res = await fetch(base + `/runs/${runId}/execution-log`, {
    headers: key ? { 'X-API-Key': key } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${runId}.log`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export async function downloadRunCode(runId, customBaseUrl = null) {
  const key = getApiKey();
  const base = customBaseUrl || LOCAL_BASE;
  const res = await fetch(base + `/runs/${runId}/code`, {
    headers: key ? { 'X-API-Key': key } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${runId}.py`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

// ─── Contests & Identity ──────────────────────────────────────────────────────
export async function fetchContests(customBaseUrl = null) {
  return get('/contests', customBaseUrl);
}

export async function registerStudent(userId, displayName, teamName, customBaseUrl = null) {
  return post('/contestants', {
    user_id: userId,
    display_name: displayName,
    team_name: teamName
  }, customBaseUrl);
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
// phase: 'test' = test leaderboard (test-run PnL), 'final' = round leaderboard (999.99k full run)
export async function fetchLeaderboard(roundId = null, phase = null, customBaseUrl = null) {
  const params = new URLSearchParams();
  if (roundId) params.set('round_id', roundId);
  if (phase)   params.set('phase', phase);
  const qs = params.toString();
  return get(qs ? `/leaderboard?${qs}` : '/leaderboard', customBaseUrl);
}

// ─── WebSocket telemetry connection ───────────────────────────────────────────
// wsUrl: explicit WebSocket URL (e.g. 'ws://...') — defaults to localhost WS
// Returns a { close(), send() } handle.
export function connectTelemetryWS(onMessage, onConnect, onDisconnect, wsUrl = null) {
  let WS_URL = wsUrl;

  if (!WS_URL) {
    // Build from VITE_API_URL (localhost)
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8080';
    const url = new URL(apiBase);
    WS_URL = (url.protocol === 'https:' ? 'wss://' : 'ws://') + url.host + '/ws/telemetry';
  }

  let ws      = null;
  let closed  = false;
  let retries = 0;

  function connect() {
    if (closed) return;
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      retries = 0;
      console.log('[WS] Telemetry connected:', WS_URL);
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

// ─── Cloud URL helpers ────────────────────────────────────────────────────────
export function getCloudBaseUrl() { return CLOUD_BASE; }
export function getCloudWsUrl()   { return CLOUD_WS ? CLOUD_WS + '/telemetry' : null; }
export function getLocalBaseUrl()  { return LOCAL_BASE; }

// ─── Contest Creator Endpoints ───────────────────────────────────────────────
export async function uploadRoundDataset(roundId, file, isFinal = false, customBaseUrl = null) {
  const endpoint = isFinal ? `/rounds/${roundId}/final-dataset` : `/rounds/${roundId}/dataset`;
  const form = new FormData();
  form.append('dataset', file);

  const key = getApiKey();
  const base = customBaseUrl || LOCAL_BASE;
  const res = await fetch(base + endpoint, {
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

export async function triggerFinalEvaluation(roundId, customBaseUrl = null) {
  return post(`/rounds/${roundId}/final-eval`, {}, customBaseUrl);
}
