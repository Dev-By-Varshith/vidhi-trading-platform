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

const BACKEND_ALLOWED_STATE_FIELDS = new Set([
  'bid_price',
  'ask_price',
  'mid_price',
  'spread',
  'last_trade_price',
  'last_trade_volume',
  'underlying_signal',
  'volatility',
  'bid_depth',
  'ask_depth',
  'position',
  'cash',
  'pnl',
  'fill_count',
  'fills',
  'ema_fast',
  'ema_slow',
  'tick_count',
  'my_position',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7',
]);

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
    this.logHistory = [];

    this._resetDecimation();

    // High-velocity telemetry throttling (Step 4)
    this._telemetryBuffer = null;
    this._telemetryThrottleTimer = null;

    // Check backend on boot (non-blocking)
    this._detectBackend();
  }

  _resetDecimation() {
    this._decimation = {
      pnl: [],
      latency: [],
      volume: [],
      bucketTickCount: 1, // Will be set to maxTicks / 1000
      currentBucket: { count: 0, pnl: 0, lat: 0, vol: 0, tick: 0 }
    };
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
    console.log('[WS] Message:', msg);
    if (msg.type === 'RUN_UPDATE' && msg.payload) {
      if (this.currentRunId && msg.payload.run_id !== this.currentRunId) return; // filter crosstalk
      const run = msg.payload;
      this._setStatus(run.status); // Update engine status whenever backend status changes
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
        oom:        run.oom         ?? false,
        violations: run.violations  ?? 0,
        correctness: run.correctness ?? 1.0,
        code:       this.currentCode,
      };

      if (run.status === 'complete' || run.status === 'error' || run.status === 'tle') {
        this.isSimulating = false;
        this._setStatus(run.status === 'complete' ? 'done' : 'error');
        this.lastState = { ...this.lastState, ...mapped, done: true };
        this.completeSubscribers.forEach(cb => cb(mapped));
        if (run.status === 'complete') {
          this._log(`[GM] Run complete — PnL=${mapped.pnlPct?.toFixed(4)}% p99=${mapped.p99?.toFixed(0)}ns correctness=${mapped.correctness?.toFixed(3)}`);
        } else if (run.status === 'tle') {
          this._log('[ERROR] Run hit the time limit before producing a valid result.');
        } else {
          this._log('[ERROR] Run failed before simulation output was produced.');
        }

        // Update local leaderboard and history
        const roundId = ContestStore.getActiveRoundId() || 'round1';
        const contestId = ContestStore.state.activeContestId;
        
        if (run.status === 'complete') {
          ContestStore.recordResult({
            contestId,
            roundId,
            pnlPct: mapped.pnlPct,
            p99: mapped.p99,
            fills: mapped.totalFills,
            pnlHistory: this._decimation.pnl
          });
        }

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
          violations: mapped.violations,
          history: this._decimation.pnl,
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
        
        // Step 4: High-velocity throttling
        // Store the latest tick in the buffer
        this._telemetryBuffer = msg.payload;

        if (!this._telemetryThrottleTimer) {
          // Process at ~16ms (60fps) or ~33ms (30fps) to keep UI smooth
          this._telemetryThrottleTimer = setTimeout(() => {
            if (this._telemetryBuffer) {
              this._processTick(this._telemetryBuffer);
              this._telemetryBuffer = null;
            }
            this._telemetryThrottleTimer = null;
          }, 33); // 30fps is plenty for trading visuals
        }
    }
  }

  _processTick(t) {
    const prev = this.lastState || {};
    const tickFills = t.fill_count ?? 0;
    const mappedTick = {
        ...prev,
        tick:       t.tick_id   ?? prev.tick    ?? 0,
        tickId:     t.tick_id,
        pnl:        t.pnl       ?? prev.pnl     ?? 0,
        pnlPct:     ((t.pnl ?? 0) / 100000) * 100,   // $100k starting capital
        position:   t.pos       ?? prev.position ?? 0,
        p50:        t.p50_ns    ?? prev.p50     ?? 0,
        p99:        t.p99_ns    ?? prev.p99     ?? 0,
        // LOB market data
        bidPrice:   t.bid_price  ?? prev.bidPrice  ?? 0,
        askPrice:   t.ask_price  ?? prev.askPrice  ?? 0,
        spread:     t.spread     ?? prev.spread    ?? 0,
        lastTrade:  t.last_trade ?? prev.lastTrade ?? 0,
        fillCount:  tickFills,
        totalFills: (prev.totalFills ?? 0) + tickFills,
        // Depth is derived from the best bid/ask provided by the engine.
        // In a real HFT environment, depth is often sparse, so we synthesize 
        // a tight book around the best prices.
        // bidDepth / askDepth come from the worker's real LOB snapshot.
        // bid_vol_N and ask_vol_N are populated by the worker TICK_UPDATE payload.
        bidDepth: t.bid_price ? [
          { price: t.bid_price,        volume: t.bid_vol_0 ?? 50  },
          { price: t.bid_price - 0.01, volume: t.bid_vol_1 ?? 80  },
          { price: t.bid_price - 0.02, volume: t.bid_vol_2 ?? 120 },
          { price: t.bid_price - 0.03, volume: t.bid_vol_3 ?? 200 },
          { price: t.bid_price - 0.04, volume: t.bid_vol_4 ?? 320 },
        ] : (prev.bidDepth ?? []),
        askDepth: t.ask_price ? [
          { price: t.ask_price,        volume: t.ask_vol_0 ?? 50  },
          { price: t.ask_price + 0.01, volume: t.ask_vol_1 ?? 80  },
          { price: t.ask_price + 0.02, volume: t.ask_vol_2 ?? 120 },
          { price: t.ask_price + 0.03, volume: t.ask_vol_3 ?? 200 },
          { price: t.ask_price + 0.04, volume: t.ask_vol_4 ?? 320 },
        ] : (prev.askDepth ?? []),
        botActivity: t.bot_activity || (Object.keys(prev.botActivity || {}).length > 0 ? prev.botActivity : {
          BOT_MARKET_MAKER:   0,
          BOT_MOMENTUM:       0,
          BOT_MEAN_REVERSION: 0,
          BOT_NOISE:          0,
          BOT_SNIPER:         0,
        }),
    };
    
    const maxTicks = prev.maxTicks ?? 100_000;
    mappedTick.maxTicks = maxTicks;
    mappedTick.progress = Math.min((t.tick_id ?? 0) / maxTicks, 1);

    // Step 5: Rolling Ring Buffers (Max 1,000 points)
    const timeVal = t.tick_id || 0;
    this._decimation.pnl.push({ time: timeVal, value: t.pnl ?? 0 });
    this._decimation.latency.push({ time: timeVal, value: t.p50_ns ?? 0 });
    this._decimation.volume.push({ time: timeVal, value: Math.abs(t.pos ?? 0) });

    if (this._decimation.pnl.length > 1000) this._decimation.pnl.shift();
    if (this._decimation.latency.length > 1000) this._decimation.latency.shift();
    if (this._decimation.volume.length > 1000) this._decimation.volume.shift();

    mappedTick.pnlHistory = [...this._decimation.pnl];
    mappedTick.latencyHistory = [...this._decimation.latency];
    mappedTick.volumeHistory = [...this._decimation.volume];

    this.lastState = mappedTick;
    this.subscribers.forEach(cb => cb(mappedTick));
  }

  // ── Worker message handler (local mode) ────────────────────────────────────
  _initWorker() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.worker = new Worker(
      new URL('./simulation.worker.js', import.meta.url),
      { type: 'module' }
    );
    this.worker.onmessage = (e) => this._handleLocalMessage(e.data);
    this.worker.onerror = (err) => {
      this._failBeforeRun('Worker crashed: ' + err.message);
    };
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
      this.lastState = { ...this.lastState, error: payload.error };
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
    // If we're currently in local fallback mode, check if the backend came back online
    if (this.mode === 'local') {
      await this._detectBackend();
    }

    this.isSimulating = true;
    this._setStatus('queued');
    this.lastState = null;
    this.currentCode = code;
    this._resetDecimation();
    this.logHistory = [];

    // Force mode based on isFinal flag
    if (this.mode === 'backend') {
      await this._startBackendRun(code, { ...options, isPractice: !options.isFinal });
    } else {
      if (options.isFinal) {
        this._failBeforeRun('Backend unreachable for Final Submission. Please check connectivity.');
        return;
      } else {
        this._startLocalRun(code, options);
      }
    }
  }

  // Backend path: POST /api/submit → poll until done
  async _startBackendRun(code, options = {}) {
    const validationError = this._validateBackendPython(code);
    if (validationError) {
      this._failBeforeRun(validationError);
      return;
    }

    this._log('[FORGE] Submitting to backend forge pipeline...');
    try {
      const storeState = ContestStore.state;
      const userId = storeState.studentId || (storeState.studentName
        ? storeState.studentName.replace(/\s+/g, '_').toLowerCase()
        : 'anonymous');
      
      const roundId = ContestStore.getActiveRoundId() || 'round1';
      
      // Step 3: Fetch bot config from active round
      const activeContest = ContestStore.getActiveContest();
      const activeRound = activeContest?.rounds?.find(r => r.id === roundId);
      const botConfig = activeRound?.activeBots ? activeRound.activeBots.map(b => `${b}:${activeRound.botAggressiveness || 0.5}`).join(',') : '';

      // Ensure API key is provisioned before submitting
      const { autoProvisionApiKey } = await import('../api/client');
      await autoProvisionApiKey(userId);

      // If this is a final submission, route it to the cloud API instead of the local dev API
      const isFinalRun = !options.isPractice;
      let targetUrl = null;
      if (isFinalRun && import.meta.env.VITE_CLOUD_API_URL) {
        targetUrl = import.meta.env.VITE_CLOUD_API_URL + '/api';
      }

      let run_id;
      try {
        const result = await submitCode(code, userId, roundId, options.isPractice, botConfig, targetUrl);
        run_id = result.run_id;
      } catch (e) {
        if (e.message.includes('401') || e.message.includes('invalid or expired')) {
          this._log('[AUTH] API key expired, provisioning new one and retrying...');
          await autoProvisionApiKey(userId);
          const retryResult = await submitCode(code, userId, roundId, options.isPractice, botConfig, targetUrl);
          run_id = retryResult.run_id;
        } else {
          throw e;
        }
      }

      this.currentRunId = run_id;
      this._log(`[FORGE] Run ID: ${run_id} — pipeline started`);
      this._log('[FORGE] AST scan → transpile → Numba AOT → Game Master...');
      // Do NOT set to 'running' yet — let backend status updates (WS) drive the status!

      // Kick off polling in background (WS handles final result, but poll as fallback)
      const maxTicks = options.maxTicks || 1_000_000;
      pollRunUntilDone(run_id, (run) => {
        const msg = `[POLL] ${run.status} — tick ${(run.total_ticks || 0).toLocaleString()}`;
        this._log(msg);

        // Update progress bar via tick update
        if (run.status === 'running') {
          this.lastState = {
            ...(this.lastState || {}),
            tick:      run.total_ticks ?? 0,
            maxTicks:  maxTicks,
            progress:  (run.total_ticks ?? 0) / maxTicks,
            pnl:       run.pnl     ?? 0,
            pnlPct:    run.pnl_pct ?? 0,
          };
          this.subscribers.forEach(cb => cb(this.lastState));
        }

        if (run.status === 'error' || run.status === 'tle') {
          const errorMessage = run.status === 'tle'
            ? 'Submission timed out during backend execution.'
            : 'Submission failed in the Forge pipeline before live simulation ticks started.';
          this.isSimulating = false;
          this._setStatus('error');
          this.lastState = {
            ...(this.lastState || {}),
            runId: run.run_id,
            status: run.status,
            errorMessage,
            tlCount: run.tle_count ?? 0,
            done: true,
            code: this.currentCode,
          };
          this.completeSubscribers.forEach(cb => cb(this.lastState));
        }
      }, targetUrl).catch(e => this._log('[POLL] ' + e.message));

    } catch (e) {
      this._failBeforeRun('Backend submit failed: ' + e.message);
    }
  }

  _validateBackendPython(code) {
    const matches = [...code.matchAll(/\bstate\.([A-Za-z_][A-Za-z0-9_]*)\b/g)];
    const unsupported = [...new Set(
      matches
        .map(([, field]) => field)
        .filter(field => !BACKEND_ALLOWED_STATE_FIELDS.has(field))
    )];

    if (unsupported.length === 0) return null;

    return `Unsupported backend state field(s): ${unsupported.join(', ')}. Use SDK fields like state.position, state.tick_count, state.ema_fast / state.ema_slow, or custom slots state.s0..state.s7.`;
  }

  _failBeforeRun(errorMessage) {
    this.isSimulating = false;
    this._setStatus('error');
    this.lastState = {
      status: 'error',
      errorMessage,
      done: true,
      code: this.currentCode,
    };
    this._log('[ERROR] ' + errorMessage);
    this.completeSubscribers.forEach(cb => cb(this.lastState));
    this.subscribers.forEach(cb => cb(this.lastState));
  }

  // Local path: Web Worker
  _startLocalRun(code, options = {}) {
    this._log('[LOCAL] Starting Web Worker simulation...');
    const activeContest = ContestStore.getActiveContest();
    const activeRoundId = ContestStore.getActiveRoundId();
    const activeRound = activeContest?.rounds?.find(r => r.id === activeRoundId) || activeContest?.rounds?.[0] || null;
    const datasetKey = options.isFinal
      ? (activeRound?.finalDataKey || activeRound?.final_dataset_path || 'eval_1m.bin')
      : (activeRound?.testDataKey || activeRound?.dataset_path || 'public_99k.bin');
    const botConfig = activeRound?.activeBots
      ? activeRound.activeBots.map(b => `${b}:${activeRound.botAggressiveness || 0.5}`).join(',')
      : 'MM:0.5,NOISE:0.5';

    this._initWorker();
    this.worker.postMessage({
      type: 'START_SIMULATION',
      payload: {
        code,
        datasetKey,
        botConfig,
        basePrice: activeRound?.asset?.basePrice || activeRound?.basePrice || 1500,
        assetName: activeRound?.asset?.name || activeRound?.assetName || 'VIDHI',
        ...options
      }
    });
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
    cb(this.status);
    return () => this.statusSubscribers.delete(cb);
  }

  onComplete(cb) {
    this.completeSubscribers.add(cb);
    return () => this.completeSubscribers.delete(cb);
  }

  getStatus()    { return this.status; }
  getLastState() { return this.lastState; }
  getLogHistory() { return [...this.logHistory]; }
  getMode()      { return this.mode; }
  getCurrentRunId() { return this.currentRunId; }

  // ── Internals ─────────────────────────────────────────────────────────────
  _setStatus(s) {
    this.status = s;
    // Notify subscribers with both status and the latest log message
    const lastLog = this.logHistory[this.logHistory.length - 1] || '';
    this.statusSubscribers.forEach(cb => cb(s, lastLog));
  }

  _log(msg) {
    this.logHistory.push(msg);
    if (this.logHistory.length > 50) this.logHistory.shift();
    this.statusSubscribers.forEach(cb => cb(this.status, msg));
    console.log(msg);
  }
}

const engine = new VidhiEngine();
export default engine;
