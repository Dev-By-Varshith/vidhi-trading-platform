// VidhiEngine.js — Global Singleton Simulation Controller v3
//
// THREE MODES:
//   forceLocal  → always use JS Web Worker (real CSV tick data + bots in browser)
//   forceCloud  → always use AWS cloud backend (C++ GM, real CSV, real bots, Python code)
//   auto        → probe localhost first; cloud if unreachable (legacy fallback)
//
// Button wiring (CodeArena):
//   "Run Test Case (Local)"  → startSimulation(code, { forceLocal: true })
//   "Run Test Cloud"         → startSimulation(code, { forceCloud: true })

import {
  submitCode,
  pollRunUntilDone,
  connectTelemetryWS,
  checkBackendHealth,
  checkCloudHealth,
  autoProvisionApiKey,
  getCloudBaseUrl,
  getCloudWsUrl,
} from '../api/client.js';
import ContestStore from '../store/ContestStore.js';

const BACKEND_ALLOWED_STATE_FIELDS = new Set([
  'bid_price', 'ask_price', 'mid_price', 'spread',
  'last_trade_price', 'last_trade_volume',
  'underlying_signal', 'volatility',
  'bid_depth', 'ask_depth',
  'position', 'cash', 'pnl',
  'fill_count', 'fills',
  'ema_fast', 'ema_slow', 'tick_count', 'my_position',
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

    this.lastState    = null;
    this.status       = 'idle';
    // mode: 'local' | 'backend' | 'cloud'
    this.mode         = 'local';
    this.currentRunId = null;
    this.currentCode  = null;
    this._wsHandle    = null;
    this.logHistory   = [];

    this._resetDecimation();

    // High-velocity telemetry throttling
    this._telemetryBuffer       = null;
    this._telemetryThrottleTimer = null;

    // Probe backends on boot (non-blocking — for auto-detect legacy path only)
    this._detectBackends();
  }

  _resetDecimation() {
    this._decimation = {
      pnl:     [],
      latency: [],
      volume:  [],
      bucketTickCount:  1,
      currentBucket: { count: 0, pnl: 0, lat: 0, vol: 0, tick: 0 }
    };
  }

  // ── Backend detection (non-blocking, for UI status only) ──────────────────
  async _detectBackends() {
    const [localUp, cloudUp] = await Promise.all([
      checkBackendHealth().catch(() => false),
      checkCloudHealth().catch(() => false),
    ]);

    if (cloudUp) {
      this._cloudAvailable = true;
      this._log('[ENGINE] ✓ AWS Cloud backend reachable.');
    } else {
      this._cloudAvailable = false;
      this._log('[ENGINE] ⚠ AWS Cloud backend unreachable (check VITE_CLOUD_API_URL).');
    }

    if (localUp) {
      this._localBackendAvailable = true;
      this._log('[ENGINE] ✓ Local backend reachable (localhost:8080).');
    } else {
      this._localBackendAvailable = false;
    }

    this.statusSubscribers.forEach(cb => cb(this.status, null));
  }

  // ── WebSocket management ──────────────────────────────────────────────────
  _connectWS(wsUrl = null) {
    if (this._wsHandle) {
      try { this._wsHandle.close(); } catch (_) {}
      this._wsHandle = null;
    }

    this._wsHandle = connectTelemetryWS(
      (msg) => this._handleWSMessage(msg),
      ()    => {
        this._log(`[WS] Telemetry stream connected${wsUrl ? ' (AWS Cloud)' : ' (localhost)'}`);
        this._wsReconnectAttempt = 0;
      },
      ()    => {
        this._log('[WS] Telemetry disconnected — reconnecting...');
        const delay = Math.min(1000 * Math.pow(2, this._wsReconnectAttempt ?? 0), 30000);
        this._wsReconnectAttempt = (this._wsReconnectAttempt ?? 0) + 1;
        this._log(`[WS] Retry in ${delay / 1000}s (attempt ${this._wsReconnectAttempt})`);
        // reconnect handled inside connectTelemetryWS itself
      },
      wsUrl, // null = localhost, string = cloud
    );
  }

  _disconnectWS() {
    if (this._wsHandle) {
      try { this._wsHandle.close(); } catch (_) {}
      this._wsHandle = null;
    }
  }

  _handleWSMessage(msg) {
    if (msg.type === 'RUN_UPDATE' && msg.payload) {
      if (this.currentRunId && msg.payload.run_id !== this.currentRunId) return;
      const run = msg.payload;
      // NOTE: do NOT call _setStatus here yet — build mapped first so lastState is valid
      const mapped = {
        runId:       run.run_id,
        status:      run.status,
        pnl:         run.pnl          ?? 0,
        pnlPct:      run.pnl_pct      ?? 0,
        p50:         run.p50_ns       ?? 0,
        p99:         run.p99_ns       ?? 0,
        totalFills:  run.total_fills  ?? 0,
        totalTicks:  run.total_ticks  ?? 0,
        tlCount:     run.tle_count    ?? 0,
        oom:         run.oom          ?? false,
        violations:  run.violations   ?? 0,
        correctness: run.correctness  ?? 1.0,
        code:        this.currentCode,
      };

      if (run.status === 'complete' || run.status === 'error' || run.status === 'tle') {
        this.isSimulating = false;
        this._pollStopped = true;  // tell polling loop to stop
        // Set lastState FIRST so onStatus subscribers read valid state
        this.lastState = { ...this.lastState, ...mapped, done: true };
        this._setStatus(run.status === 'complete' ? 'done' : 'error');
        this.completeSubscribers.forEach(cb => cb(mapped));

        if (run.status === 'complete') {
          this._log(`[GM] Run complete — PnL=${mapped.pnlPct?.toFixed(4)}% p99=${mapped.p99?.toFixed(0)}ns correctness=${mapped.correctness?.toFixed(3)}`);
        } else if (run.status === 'tle') {
          this._log('[ERROR] Run hit the time limit before producing a valid result.');
        } else {
          this._log('[ERROR] Run failed before simulation output was produced.');
        }

        // Record result
        const roundId   = ContestStore.getActiveRoundId() || 'round1';
        const contestId = ContestStore.state.activeContestId;

        if (run.status === 'complete') {
          ContestStore.recordResult({
            contestId, roundId,
            pnlPct:     mapped.pnlPct,
            p99:        mapped.p99,
            fills:      mapped.totalFills,
            pnlHistory: this._decimation.pnl,
            isCloudRun: this.mode === 'cloud',
          });
        }

        ContestStore.addRunHistory({
          id:          mapped.runId,
          status:      mapped.status,
          mode:        this.mode,
          pnl:         mapped.pnl,
          pnlPct:      mapped.pnlPct,
          p50:         mapped.p50,
          p99:         mapped.p99,
          fills:       mapped.totalFills,
          ticks:       mapped.totalTicks,
          correctness: mapped.correctness,
          violations:  mapped.violations,
          history:     this._decimation.pnl,
          botActivity: this.lastState?.botActivity || {},
          code:        mapped.code,
        });

      } else {
        this.lastState = { ...this.lastState, ...mapped };
        this.subscribers.forEach(cb => cb(this.lastState));
        this._log(`[GM] Status: ${run.status}`);
      }

    } else if (msg.type === 'TICK_TELEMETRY' && msg.payload && this.isSimulating) {
      if (this.currentRunId && msg.run_id !== this.currentRunId) return;
      this._telemetryBuffer = msg.payload;
      if (!this._telemetryThrottleTimer) {
        this._telemetryThrottleTimer = setTimeout(() => {
          if (this._telemetryBuffer) {
            this._processTick(this._telemetryBuffer);
            this._telemetryBuffer = null;
          }
          this._telemetryThrottleTimer = null;
        }, 33); // 30fps
      }
    }
  }

  _processTick(t) {
    const prev     = this.lastState || {};
    const tickFills = t.fill_count ?? 0;
    const mappedTick = {
      ...prev,
      tick:       t.tick_id    ?? prev.tick    ?? 0,
      tickId:     t.tick_id,
      pnl:        t.pnl        ?? prev.pnl     ?? 0,
      pnlPct:     ((t.pnl ?? 0) / 100000) * 100,
      position:   t.pos        ?? prev.position ?? 0,
      p50:        t.p50_ns     ?? prev.p50     ?? 0,
      p99:        t.p99_ns     ?? prev.p99     ?? 0,
      bidPrice:   t.bid_price  ?? prev.bidPrice  ?? 0,
      askPrice:   t.ask_price  ?? prev.askPrice  ?? 0,
      spread:     t.spread     ?? prev.spread    ?? 0,
      lastTrade:  t.last_trade ?? prev.lastTrade ?? 0,
      fillCount:  tickFills,
      totalFills: (prev.totalFills ?? 0) + tickFills,
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
      botActivity: t.bot_activity || prev.botActivity || {
        BOT_MARKET_MAKER:   0,
        BOT_MOMENTUM:       0,
        BOT_MEAN_REVERSION: 0,
        BOT_NOISE:          0,
        BOT_SNIPER:         0,
      },
    };

    const maxTicks        = prev.maxTicks ?? 100_000;
    mappedTick.maxTicks   = maxTicks;
    mappedTick.progress   = Math.min((t.tick_id ?? 0) / maxTicks, 1);

    const timeVal = t.tick_id || 0;
    this._decimation.pnl.push({ time: timeVal, value: t.pnl ?? 0 });
    this._decimation.latency.push({ time: timeVal, value: t.p50_ns ?? 0 });
    this._decimation.volume.push({ time: timeVal, value: Math.abs(t.pos ?? 0) });

    if (this._decimation.pnl.length     > 1000) this._decimation.pnl.shift();
    if (this._decimation.latency.length > 1000) this._decimation.latency.shift();
    if (this._decimation.volume.length  > 1000) this._decimation.volume.shift();

    mappedTick.pnlHistory     = [...this._decimation.pnl];
    mappedTick.latencyHistory = [...this._decimation.latency];
    mappedTick.volumeHistory  = [...this._decimation.volume];

    this.lastState = mappedTick;
    this.subscribers.forEach(cb => cb(mappedTick));
  }

  // ── Worker (local mode) ───────────────────────────────────────────────────
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
      const finalPayload = { ...payload, code: this.currentCode, mode: 'local' };
      this.lastState = { ...this.lastState, ...finalPayload, done: true };
      this.completeSubscribers.forEach(cb => cb(finalPayload));
      this._log(`[OK] Local simulation complete. PnL: ${payload.pnlPct?.toFixed(4)}%`);

      ContestStore.addRunHistory({
        id:          `local_${Date.now()}`,
        status:      'complete',
        mode:        'local',
        pnl:         payload.finalPnl || payload.pnl || 0,
        pnlPct:      payload.pnlPct   || 0,
        p50:         payload.p50      || 0,
        p99:         payload.p99      || 0,
        fills:       payload.totalFills || 0,
        ticks:       payload.totalTicks || 0,
        correctness: null,
        history:     payload.pnlHistory || [],
        botActivity: payload.botActivity || {},
        code:        this.currentCode,
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
      done:        true,
      runId:       run.id,
      pnl:         run.pnl,
      pnlPct:      run.pnlPct,
      p50:         run.p50,
      p99:         run.p99,
      totalFills:  run.fills,
      totalTicks:  run.ticks,
      tick:        run.ticks,
      correctness: run.correctness,
      pnlHistory:  run.history,
      botActivity: run.botActivity,
      mode:        run.mode,
    };
    this.subscribers.forEach(cb => cb(this.lastState));
  }

  /**
   * startSimulation(code, options)
   *
   * options.forceLocal  {boolean} — always run JS worker (never hit any backend)
   * options.forceCloud  {boolean} — always route to AWS cloud backend
   * options.maxTicks    {number}  — number of ticks (default 100_000)
   * options.isFinal     {boolean} — marks run as final (not practice)
   */
  async startSimulation(code, options = {}) {
    this.isSimulating = true;
    this._setStatus('queued');
    this.lastState   = null;
    this.currentCode = code;
    this._resetDecimation();
    this.logHistory  = [];
    this._pollStopped = false;  // reset poll guard for new run

    // Disconnect any existing WS before starting a new run
    this._disconnectWS();

    if (options.forceLocal) {
      // ── LOCAL: always JS Web Worker ─────────────────────────────────────
      this.mode = 'local';
      this._log('[ENGINE] ⚡ Local JS Worker simulation starting...');
      this._startLocalRun(code, options);

    } else if (options.forceCloud) {
      // ── CLOUD: always AWS backend ────────────────────────────────────────
      this.mode = 'cloud';
      this._log('[ENGINE] ☁ Cloud (AWS) simulation starting...');
      await this._startCloudRun(code, options);

    } else {
      // ── AUTO: legacy fallback (probe localhost, else JS worker) ──────────
      const localUp = await checkBackendHealth().catch(() => false);
      if (localUp) {
        this.mode = 'backend';
        this._log('[ENGINE] ✓ Auto-selected local backend (localhost:8080).');
        await this._startBackendRun(code, options, null);
      } else {
        this.mode = 'local';
        this._log('[ENGINE] Backend offline — using JS Web Worker simulation (fallback).');
        this._startLocalRun(code, options);
      }
    }
  }

  // ── Cloud path: POST to AWS ALB → poll → WS telemetry ────────────────────
  async _startCloudRun(code, options = {}) {
    // Fallback to hardcoded ALB URL if env var not set at build time
    const HARDCODED_ALB = 'http://vidhi-alb-141110176.us-east-1.elb.amazonaws.com';
    let cloudBase = getCloudBaseUrl();
    let cloudWs   = getCloudWsUrl();

    // If env var is missing, fall back to the hardcoded known ALB
    if (!cloudBase || cloudBase === '/api') {
      cloudBase = HARDCODED_ALB + '/api';
      cloudWs   = 'ws://vidhi-alb-141110176.us-east-1.elb.amazonaws.com/ws/telemetry';
      this._log(`[CLOUD] VITE_CLOUD_API_URL not set — using hardcoded ALB: ${HARDCODED_ALB}`);
    } else {
      this._log(`[CLOUD] Target: ${cloudBase}`);
    }

    const validationError = this._validateBackendPython(code);
    if (validationError) {
      this._failBeforeRun(validationError);
      return;
    }

    this._log('[CLOUD] Connecting WebSocket telemetry to AWS...');
    // Connect cloud WS first so we don't miss early messages
    this._connectWS(cloudWs);

    this._log(`[CLOUD] Submitting to ${cloudBase}/submit ...`);
    try {
      const storeState = ContestStore.state;
      const userId = storeState.studentId || (storeState.studentName
        ? storeState.studentName.replace(/\s+/g, '_').toLowerCase()
        : 'anonymous');
      const roundId = ContestStore.getActiveRoundId() || 'round1';

      const activeContest = ContestStore.getActiveContest();
      const activeRound   = activeContest?.rounds?.find(r => r.id === roundId);
      const botConfig     = activeRound?.activeBots
        ? activeRound.activeBots.map(b => `${b}:${activeRound.botAggressiveness || 0.5}`).join(',')
        : '';

      // Provision API key against cloud backend
      await autoProvisionApiKey(userId, cloudBase);

      let run_id;
      try {
        const result = await submitCode(code, userId, roundId, /*isPractice=*/true, botConfig, cloudBase);
        run_id = result.run_id;
      } catch (e) {
        if (e.message.includes('401') || e.message.includes('invalid or expired')) {
          this._log('[AUTH] API key expired, provisioning new one...');
          await autoProvisionApiKey(userId, cloudBase);
          const retryResult = await submitCode(code, userId, roundId, true, botConfig, cloudBase);
          run_id = retryResult.run_id;
        } else if (e.message === 'Failed to fetch' || e.message.includes('NetworkError') || e.message.includes('CORS')) {
          this._failBeforeRun(
            `Cloud connection failed (CORS/Network): Cannot reach ${cloudBase}\n\n` +
            `This usually means the AWS ALB is not running or is blocking cross-origin requests from the S3 site.\n` +
            `Check: Is the backend ECS service running? Does the ALB have CORS headers set?`
          );
          return;
        } else {
          throw e;
        }
      }

      this.currentRunId = run_id;
      this._log(`[CLOUD] Run ID: ${run_id} — pipeline started on AWS`);
      this._log('[CLOUD] AST scan → transpile → Numba AOT → C++ Game Master (AWS)...');

      // Kick off polling as fallback for WS
      const maxTicks = options.maxTicks || 100_000;
      pollRunUntilDone(run_id, (run) => {
        // If WS already handled terminal status, skip poll callbacks to avoid duplicate alerts
        if (this._pollStopped) return;

        const msg = `[POLL/CLOUD] ${run.status} — tick ${(run.total_ticks || 0).toLocaleString()}`;
        this._log(msg);

        if (run.status === 'running') {
          this.lastState = {
            ...(this.lastState || {}),
            tick:     run.total_ticks ?? 0,
            maxTicks: maxTicks,
            progress: (run.total_ticks ?? 0) / maxTicks,
            pnl:      run.pnl     ?? 0,
            pnlPct:   run.pnl_pct ?? 0,
            mode:     'cloud',
          };
          this.subscribers.forEach(cb => cb(this.lastState));
        }

        if (run.status === 'error' || run.status === 'tle') {
          if (this._pollStopped) return;  // double-check after async gap
          const errorMessage = run.status === 'tle'
            ? 'Cloud submission timed out during backend execution.'
            : 'Cloud submission failed in the Forge pipeline before live simulation ticks started.';
          this.isSimulating = false;
          this._pollStopped = true;
          // Set lastState BEFORE _setStatus so subscriber reads valid error info
          this.lastState = {
            ...(this.lastState || {}),
            runId:        run.run_id,
            status:       run.status,
            errorMessage,
            tlCount:      run.tle_count ?? 0,
            done:         true,
            mode:         'cloud',
            code:         this.currentCode,
          };
          this._setStatus('error');
          this.completeSubscribers.forEach(cb => cb(this.lastState));
        }
      }, cloudBase).catch(e => this._log('[POLL/CLOUD] ' + e.message));


    } catch (e) {
      this._failBeforeRun('Cloud submit failed: ' + e.message);
    }
  }

  // ── Local-backend path (legacy auto-detect): POST to localhost → poll → WS ─
  async _startBackendRun(code, options = {}, _unused = null) {
    const validationError = this._validateBackendPython(code);
    if (validationError) {
      this._failBeforeRun(validationError);
      return;
    }

    // Connect to local WS
    this._connectWS(null);

    this._log('[FORGE] Submitting to local backend forge pipeline...');
    try {
      const storeState = ContestStore.state;
      const userId = storeState.studentId || (storeState.studentName
        ? storeState.studentName.replace(/\s+/g, '_').toLowerCase()
        : 'anonymous');
      const roundId   = ContestStore.getActiveRoundId() || 'round1';
      const activeContest = ContestStore.getActiveContest();
      const activeRound   = activeContest?.rounds?.find(r => r.id === roundId);
      const botConfig     = activeRound?.activeBots
        ? activeRound.activeBots.map(b => `${b}:${activeRound.botAggressiveness || 0.5}`).join(',')
        : '';

      await autoProvisionApiKey(userId, null);

      let run_id;
      try {
        const result = await submitCode(code, userId, roundId, options.isPractice !== false, botConfig, null);
        run_id = result.run_id;
      } catch (e) {
        if (e.message.includes('401') || e.message.includes('invalid or expired')) {
          this._log('[AUTH] API key expired, provisioning new one and retrying...');
          await autoProvisionApiKey(userId, null);
          const retryResult = await submitCode(code, userId, roundId, options.isPractice !== false, botConfig, null);
          run_id = retryResult.run_id;
        } else {
          throw e;
        }
      }

      this.currentRunId = run_id;
      this._log(`[FORGE] Run ID: ${run_id} — pipeline started`);
      this._log('[FORGE] AST scan → transpile → Numba AOT → Game Master...');

      const maxTicks = options.maxTicks || 100_000;
      pollRunUntilDone(run_id, (run) => {
        this._log(`[POLL] ${run.status} — tick ${(run.total_ticks || 0).toLocaleString()}`);
        if (run.status === 'running') {
          this.lastState = {
            ...(this.lastState || {}),
            tick:     run.total_ticks ?? 0,
            maxTicks: maxTicks,
            progress: (run.total_ticks ?? 0) / maxTicks,
            pnl:      run.pnl     ?? 0,
            pnlPct:   run.pnl_pct ?? 0,
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
            runId:        run.run_id,
            status:       run.status,
            errorMessage,
            tlCount:      run.tle_count ?? 0,
            done:         true,
            code:         this.currentCode,
          };
          this.completeSubscribers.forEach(cb => cb(this.lastState));
        }
      }, null).catch(e => this._log('[POLL] ' + e.message));

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
      status:       'error',
      errorMessage,
      done:         true,
      code:         this.currentCode,
    };
    this._log('[ERROR] ' + errorMessage);
    this.completeSubscribers.forEach(cb => cb(this.lastState));
    this.subscribers.forEach(cb => cb(this.lastState));
  }

  // ── Local JS Worker path ──────────────────────────────────────────────────
  _startLocalRun(code, options = {}) {
    this._log('[LOCAL] ⚡ Starting JS Web Worker simulation with real CSV tick data...');
    const activeContest  = ContestStore.getActiveContest();
    const activeRoundId  = ContestStore.getActiveRoundId();
    const activeRound    = activeContest?.rounds?.find(r => r.id === activeRoundId)
                           || activeContest?.rounds?.[0]
                           || null;

    // Use the test CSV dataset for local runs (99.99k ticks with trend)
    const datasetKey = activeRound?.testDataKey || activeRound?.dataset_path || 'test_99k.csv';
    const botConfig  = activeRound?.activeBots
      ? activeRound.activeBots.map(b => `${b}:${activeRound.botAggressiveness || 0.5}`).join(',')
      : 'MM:0.5,MOM:0.5,MR:0.5,NOISE:0.5,SNIPER:0.5';

    this._initWorker();
    this.worker.postMessage({
      type:    'START_SIMULATION',
      payload: {
        code,
        datasetKey,
        botConfig,
        basePrice:  activeRound?.asset?.basePrice || activeRound?.basePrice || 1500,
        assetName:  activeRound?.asset?.name      || activeRound?.assetName  || 'VIDHI',
        maxTicks:   options.maxTicks || 100_000,
        ...options,
      }
    });
  }

  stopSimulation() {
    this.isSimulating = false;
    if (this.worker) {
      this.worker.postMessage({ type: 'STOP_SIMULATION' });
    }
    this._disconnectWS();
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

  getStatus()       { return this.status; }
  getLastState()    { return this.lastState; }
  getLogHistory()   { return [...this.logHistory]; }
  getMode()         { return this.mode; }
  getCurrentRunId() { return this.currentRunId; }
  isCloudMode()     { return this.mode === 'cloud'; }
  isLocalMode()     { return this.mode === 'local'; }

  // ── Internals ─────────────────────────────────────────────────────────────
  _setStatus(s) {
    this.status = s;
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
