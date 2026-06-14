// VidhiEngine.js — Global Singleton Simulation Controller v2
// Bridges React components to:
//   - LOCAL: Web Worker simulation engine (browser phase, 100k ticks)
//   - BACKEND: Go control plane via /api/submit → poll /api/runs/{id}
//              + WebSocket /ws/telemetry for live telemetry from real GM
//
// Mode selection:
//   - If backend is reachable → use BACKEND mode (real forge + GM)
//   - If backend is offline   → fall back to LOCAL worker mode

import { submitCode, pollRunUntilDone, connectTelemetryWS, checkBackendHealth } from '../api/client.js';
import ContestStore from '../store/ContestStore.js';

class VidhiEngine {
  constructor() {
    if (VidhiEngine.instance) return VidhiEngine.instance;
    VidhiEngine.instance = this;

    this.worker              = null;
    this.isSimulating        = false;
    this.subscribers         = new Set();
    this.statusSubscribers   = new Set();
    this.completeSubscribers = new Set();

    this.lastState = null;
    this.status    = 'idle';
    this.mode      = 'local';    // 'local' | 'backend'
    this.currentRunId = null;
    this.currentCode  = null;
    this._wsHandle = null;

    // Check backend on boot (non-blocking)
    this._detectBackend();
  }

  // ── Backend detection ─────────────────────────────────────────────────────
  async _detectBackend() {
    try {
      const result = await checkBackendHealth();
      // checkBackendHealth now returns a plain boolean.
      // Support both boolean (new) and legacy object shape { online: bool }
      const isUp = result === true || result?.online === true || result?.status === 'ok';
      if (isUp) {
        this.mode = 'backend';
        const badge = '[ENGINE] ✓ Connected to Vidhi Control Plane (C++ GM — 100k ticks in ~4s)';
        this._log(badge);
        this.statusSubscribers.forEach(cb => cb(this.status, badge));
        // Connect WebSocket telemetry stream
        this._connectWS();
      } else {
        this.mode = 'local';
        const badge = '[ENGINE] Backend offline — using JS Web Worker simulation (fallback).';
        this._log(badge);
        this.statusSubscribers.forEach(cb => cb(this.status, badge));
      }
    } catch (e) {
      this.mode = 'local';
      this._log('[ENGINE] Local fallback active. (' + e.message + ')');
    }
  }

  // ── WebSocket telemetry (from real GM runs) ────────────────────────────────
  _connectWS() {
    if (this._wsHandle) {
      try { this._wsHandle.close(); } catch (_) {}
    }
    this._wsHandle = connectTelemetryWS(
      (msg) => this._handleWSMessage(msg),
      ()    => {
        this._log('[WS] Telemetry stream connected');
        this._wsReconnectAttempt = 0; // reset backoff on success
      },
      ()    => {
        this._log('[WS] Telemetry disconnected — reconnecting...');
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max (P2-3)
        const delay = Math.min(1000 * Math.pow(2, this._wsReconnectAttempt ?? 0), 30000);
        this._wsReconnectAttempt = (this._wsReconnectAttempt ?? 0) + 1;
        this._log(`[WS] Retry in ${delay / 1000}s (attempt ${this._wsReconnectAttempt})`);
        setTimeout(() => this._connectWS(), delay);
      },
    );
  }

  _handleWSMessage(msg) {
    if (msg.type === 'RUN_UPDATE' && msg.payload) {
      if (this.currentRunId && msg.payload.run_id !== this.currentRunId) return; // filter crosstalk
      const run = msg.payload;
      // Map backend field names → VidhiEngine state format
      const mapped = {
        runId:      run.run_id,
        status:     run.status,
        pnl:        run.pnl         ?? 0,
        pnlPct:     run.pnl_pct     ?? 0,
        p50:        run.p50_ns      ?? 0,
        p99:        run.p99_ns      ?? 0,
        totalFills: run.total_fills ?? 0,
        totalTicks: run.total_ticks ?? 0,
        tlCount:    run.tle_count   ?? 0,
        correctness: run.correctness ?? 1.0,
        code:       this.currentCode,
      };

      if (run.status === 'complete' || run.status === 'error' || run.status === 'tle') {
        this.isSimulating = false;
        this._setStatus(run.status === 'complete' ? 'done' : 'error');
        this.lastState = { ...this.lastState, ...mapped, done: true };
        this.completeSubscribers.forEach(cb => cb(mapped));
        this._log(`[GM] Run complete — PnL=${mapped.pnlPct?.toFixed(4)}% p99=${mapped.p99?.toFixed(0)}ns correctness=${mapped.correctness?.toFixed(3)}`);

        ContestStore.addRunHistory({
          id: mapped.runId,
          status: mapped.status,
          mode: 'backend',
          pnl: mapped.pnl,
          pnlPct: mapped.pnlPct,
          p50: mapped.p50,
          p99: mapped.p99,
          fills: mapped.totalFills,
          ticks: mapped.totalTicks,
          correctness: mapped.correctness,
          history: this.lastState?.pnlHistory || [],
          botActivity: this.lastState?.botActivity || {},
          code: mapped.code
        });

      } else {
        // Intermediate status update (scanning, running, queued_gm...)
        this.lastState = { ...this.lastState, ...mapped };
        this.subscribers.forEach(cb => cb(this.lastState));
        this._log(`[GM] Status: ${run.status}`);
      }
    } else if (msg.type === 'TICK_TELEMETRY' && msg.payload && this.isSimulating) {
        if (this.currentRunId && msg.run_id !== this.currentRunId) return; // filter crosstalk
        // Live tick stream from running GM binary (all LOB fields now included — P2-4)
        const t = msg.payload;
        const prev = this.lastState || {};
        const mappedTick = {
            ...prev,
            tick:       t.tick_id   ?? prev.tick    ?? 0,
            tickId:     t.tick_id,
            pnl:        t.pnl       ?? prev.pnl     ?? 0,
            pnlPct:     ((t.pnl ?? 0) / 100000) * 100,   // $100k starting capital
            position:   t.pos       ?? prev.position ?? 0,
            p50:        t.p50_ns    ?? prev.p50     ?? 0,
            p99:        t.p99_ns    ?? prev.p99     ?? 0,
            // LOB market data (live from GM telemetry)
            bidPrice:   t.bid_price  ?? prev.bidPrice  ?? 0,
            askPrice:   t.ask_price  ?? prev.askPrice  ?? 0,
            spread:     t.spread     ?? prev.spread    ?? 0,
            lastTrade:  t.last_trade ?? prev.lastTrade ?? 0,
            fillCount:  t.fill_count ?? 0,
            // Synthesize 5-level LOB depth from best bid/ask for the depth bar chart
            bidDepth: t.bid_price ? [
              { price: t.bid_price,        volume: 50  + (Math.abs(t.pos ?? 0) % 30) },
              { price: t.bid_price - 0.01, volume: 80  },
              { price: t.bid_price - 0.02, volume: 120 },
              { price: t.bid_price - 0.03, volume: 200 },
              { price: t.bid_price - 0.04, volume: 320 },
            ] : (prev.bidDepth ?? []),
            askDepth: t.ask_price ? [
              { price: t.ask_price,        volume: 50  + (Math.abs(t.pos ?? 0) % 25) },
              { price: t.ask_price + 0.01, volume: 80  },
              { price: t.ask_price + 0.02, volume: 120 },
              { price: t.ask_price + 0.03, volume: 200 },
              { price: t.ask_price + 0.04, volume: 320 },
            ] : (prev.askDepth ?? []),
        };
        // PnL history ring for sparkline (300 data points)
        mappedTick.pnlHistory = [...(prev.pnlHistory ?? []), t.pnl ?? 0];
        if (mappedTick.pnlHistory.length > 300) mappedTick.pnlHistory.shift();
        // Progress bar from tick count
        const maxTicks = prev.maxTicks ?? 100_000;
        mappedTick.maxTicks = maxTicks;
        mappedTick.progress = Math.min((t.tick_id ?? 0) / maxTicks, 1);

        this.lastState = mappedTick;
        this.subscribers.forEach(cb => cb(mappedTick));
    }
  }

  // ── Worker message handler (local mode) ────────────────────────────────────
  _initWorker() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.worker = new Worker(
      new URL('./simulation.worker.js', import.meta.url),
      { type: 'module' }
    );
    this.worker.onmessage = (e) => this._handleLocalMessage(e.data);
  }

  _handleLocalMessage({ type, payload }) {
    if (type === 'TICK_UPDATE') {
      this.lastState = payload;
      this.subscribers.forEach(cb => cb(payload));
    }
    if (type === 'COMPILE_OK') {
      this._setStatus('running');
      this._log('[OK] ' + payload.message);
    }
    if (type === 'COMPILE_ERROR') {
      this._setStatus('error');
      this._log('[ERROR] Compile failed: ' + payload.error);
    }
    if (type === 'SIMULATION_COMPLETE') {
      this.isSimulating = false;
      this._setStatus('done');
      const finalPayload = { ...payload, code: this.currentCode };
      this.lastState = { ...this.lastState, ...finalPayload, done: true };
      this.completeSubscribers.forEach(cb => cb(finalPayload));
      this._log(`[OK] Simulation complete. PnL: ${payload.pnlPct?.toFixed(4)}%`);

      ContestStore.addRunHistory({
        id: `local_${Date.now()}`,
        status: 'complete',
        mode: 'local',
        pnl: payload.finalPnl || payload.pnl || 0,
        pnlPct: payload.pnlPct || 0,
        p50: payload.p50 || 0,
        p99: payload.p99 || 0,
        fills: payload.totalFills || 0,
        ticks: payload.totalTicks || 0,
        correctness: null,
        history: payload.pnlHistory || [],
        botActivity: payload.botActivity || {},
        code: this.currentCode
      });
    }
    if (type === 'SIMULATION_STOPPED') {
      this.isSimulating = false;
      this._setStatus('idle');
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  
  loadHistoricState(run) {
    this.isSimulating = false;
    this._setStatus('done');
    this.currentRunId = run.id;
    this.lastState = {
      done: true,
      runId: run.id,
      pnl: run.pnl,
      pnlPct: run.pnlPct,
      p50: run.p50,
      p99: run.p99,
      totalFills: run.fills,
      totalTicks: run.ticks,
      tick: run.ticks,
      correctness: run.correctness,
      pnlHistory: run.history,
      botActivity: run.botActivity,
    };
    this.subscribers.forEach(cb => cb(this.lastState));
  }

  async startSimulation(code, options = {}) {
    this.isSimulating = true;
    this._setStatus('compiling');
    this.lastState = null;
    this.currentCode = code;

    if (this.mode === 'backend') {
      await this._startBackendRun(code, options);
    } else {
      this._startLocalRun(code, options);
    }
  }

  // Backend path: POST /api/submit → poll until done
  async _startBackendRun(code, options = {}) {
    this._log('[FORGE] Submitting to backend forge pipeline...');
    try {
      const storeState = ContestStore.state;
      const userId = storeState.studentId || (storeState.studentName
        ? storeState.studentName.replace(/\s+/g, '_').toLowerCase()
        : 'anonymous');
      
      const roundId = ContestStore.getActiveRoundId() || 'round1';

      const { run_id } = await submitCode(code, userId, roundId);
      this.currentRunId = run_id;
      this._log(`[FORGE] Run ID: ${run_id} — pipeline started`);
      this._log('[FORGE] AST scan → transpile → Numba AOT → Game Master...');
      this._setStatus('running');

      // Kick off polling in background (WS handles final result, but poll as fallback)
      pollRunUntilDone(run_id, (run) => {
        const msg = `[POLL] ${run.status} — tick ${(run.total_ticks || 0).toLocaleString()}`;
        this._log(msg);

        // Update progress bar via tick update
        if (run.status === 'running') {
          this.lastState = {
            ...(this.lastState || {}),
            tick:      run.total_ticks ?? 0,
            maxTicks:  1_000_000,
            progress:  (run.total_ticks ?? 0) / 1_000_000,
            pnl:       run.pnl     ?? 0,
            pnlPct:    run.pnl_pct ?? 0,
          };
          this.subscribers.forEach(cb => cb(this.lastState));
        }
      }).catch(e => this._log('[POLL] ' + e.message));

    } catch (e) {
      this._setStatus('error');
      this._log('[ERROR] Backend submit failed: ' + e.message);
      this._log('[FALLBACK] Switching to local simulation...');
      this.mode = 'local';
      this._startLocalRun(code);
    }
  }

  // Local path: Web Worker
  _startLocalRun(code, options = {}) {
    this._log('[LOCAL] Starting Web Worker simulation...');
    this._initWorker();
    this.worker.postMessage({ type: 'START_SIMULATION', payload: { code, ...options } });
  }

  stopSimulation() {
    this.isSimulating = false;
    if (this.worker) {
      this.worker.postMessage({ type: 'STOP_SIMULATION' });
    }
    this._setStatus('idle');
    this._log('[SYS] Simulation halted by user.');
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────
  subscribe(cb) {
    this.subscribers.add(cb);
    if (this.lastState) cb(this.lastState);
    return () => this.subscribers.delete(cb);
  }

  onStatus(cb) {
    this.statusSubscribers.add(cb);
    return () => this.statusSubscribers.delete(cb);
  }

  onComplete(cb) {
    this.completeSubscribers.add(cb);
    return () => this.completeSubscribers.delete(cb);
  }

  getStatus()    { return this.status; }
  getLastState() { return this.lastState; }
  getMode()      { return this.mode; }
  getCurrentRunId() { return this.currentRunId; }

  // ── Internals ─────────────────────────────────────────────────────────────
  _setStatus(s) {
    this.status = s;
    this.statusSubscribers.forEach(cb => cb(s));
  }

  _log(msg) {
    this.statusSubscribers.forEach(cb => cb(this.status, msg));
    console.log(msg);
  }
}

const engine = new VidhiEngine();
export default engine;
