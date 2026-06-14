import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Play, Square, FileText, TerminalSquare, AlertTriangle, Cpu, Bot, Zap, Wifi, WifiOff, Key, Check, X, Clock, Loader } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import VidhiEngine from '../engine/VidhiEngine';
import { getApiKey, autoProvisionApiKey } from '../api/client.js';
import ContestStore from '../store/ContestStore';

const DEFAULT_CODE = `# Vidhi Arena — Dynamic Bot Trading Contest
# Your algo competes against 5 live bots in a real LOB
#
# state fields:
#   state.bid_price, state.ask_price, state.mid_price, state.spread
#   state.bid_volume, state.ask_volume
#   state.position, state.cash, state.pnl
#   state.ema_fast, state.ema_slow  (persistent across ticks)
#   state.fills  (fills from last tick)
#
# orders API:
#   orders.limit_buy(price, volume)   orders.limit_sell(price, volume)
#   orders.market_buy(volume)         orders.market_sell(volume)
#   orders.cancel(order_id)

def on_tick(state, orders):
    # EMA crossover strategy
    alpha_fast = 0.05
    alpha_slow = 0.01

    state.ema_fast = alpha_fast * state.mid_price + (1 - alpha_fast) * state.ema_fast
    state.ema_slow = alpha_slow * state.mid_price + (1 - alpha_slow) * state.ema_slow

    # Avoid crossing the spread — use limit orders
    if state.ema_fast > state.ema_slow and state.position < 100:
        orders.limit_buy(state.bid_price + 0.01, 10)

    if state.ema_fast < state.ema_slow and state.position > -100:
        orders.limit_sell(state.ask_price - 0.01, 10)
`;

const BOT_DOCS = [
  { name: 'Market Maker', color: 'var(--brand-cyan)', desc: 'Posts bid/ask quotes. Widens spread when your orders move inventory. Taker pays.' },
  { name: 'Momentum', color: 'var(--brand-blue)', desc: 'Follows price trends. If you spike the price, it front-runs further.' },
  { name: 'Mean Rev.', color: '#FFFFFF', desc: 'Fades large moves. Heavy selling into your aggressive buys.' },
  { name: 'Noise Trader', color: 'rgba(255,255,255,0.4)', desc: 'Random limit orders near best bid/ask. Creates realistic flow.' },
  { name: 'Sniper/Arb', color: 'var(--neon-red)', desc: 'Keeps prices anchored to fair value. No free arbitrage.' },
];

export default function CodeArena() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [status, setStatus] = useState('idle');
  const [mode, setMode] = useState(VidhiEngine.getMode());
  const [runId, setRunId] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(null);
  const [logs, setLogs] = useState([
    { t: 'sys', msg: '[SYS] Detecting backend...' },
  ]);
  const navigate = useNavigate();
  const consoleRef = useRef(null);

  const [storeState, setStoreState] = useState(ContestStore.state);
  useEffect(() => ContestStore.subscribe(s => setStoreState({ ...s })), []);

  const contest = ContestStore.getActiveContest();
  const activeRound = contest?.rounds?.find(r => r.status === 'active');
  const hasStarted = !contest || (activeRound && (!activeRound.startAt || new Date(activeRound.startAt).getTime() <= Date.now()));

  useEffect(() => {
    const unsub = VidhiEngine.onStatus((s, msg) => {
      setStatus(s);
      setMode(VidhiEngine.getMode());
      setRunId(VidhiEngine.getCurrentRunId());
      if (msg) setLogs(prev => [...prev.slice(-120), { t: s, msg }]);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (consoleRef.current)
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [logs]);

  const processFile = async (file) => {
    if (file && file.name.endsWith('.py')) {
      setUploadingFile(file.name);
      const text = await file.text();
      setCode(text);
      setLogs(prev => [...prev.slice(-120), { t: 'sys', msg: `[SYS] Detected ${file.name}. Reading algo...` }]);
      
      setTimeout(() => {
        setUploadingFile(null);
        handleDeploy(text);
      }, 1500);
    }
  };

  const handleDeploy = async (overrideCode = null) => {
    const codeToRun = typeof overrideCode === 'string' ? overrideCode : code;
    const m = VidhiEngine.getMode();
    setLogs([
      { t: 'sys', msg: `[SYS] Mode: ${m.toUpperCase()}` },
      {
        t: 'sys', msg: m === 'backend'
          ? '[FORGE] Sending to backend: AST scan → transpile → Numba AOT → Game Master...'
          : '[LOCAL] Launching Web Worker simulation (100k ticks)...'
      },
      { t: 'sys', msg: '[SYS] Spawning 5 bots: MM / MOM / MR / NOISE / SNIPER' },
    ]);
    if (m === 'backend') {
      let key = getApiKey();
      if (!key) {
        setLogs(prev => [...prev, { t: 'sys', msg: '[AUTH] Auto-provisioning API key for backend execution...' }]);
        const state = ContestStore.state;
        const userId = state.studentId || (state.studentName ? state.studentName.toLowerCase().replace(/\s+/g, '_') : 'anonymous');
        key = await autoProvisionApiKey(userId);
        if (!key) {
          setLogs(prev => [...prev, { t: 'error', msg: '[AUTH] Failed to automatically provision API key. Cannot connect to backend.' }]);
          return;
        }
      }
    }

    ContestStore.saveLastCode(codeToRun);

    // Find active round test dataset + bot config
    const c = ContestStore.state.contests.find(c => c.id === ContestStore.state.activeContestId);
    let options = {};
    if (c) {
      const activeRound = c.rounds.find(r => r.status === 'active');
      if (activeRound) {
        // Tick count from round config
        if (activeRound.tickCount) {
          options.maxTicks = parseInt(activeRound.tickCount, 10) || 100_000;
        }
        // Bot aggressiveness config: "MM:1.0,MOM:2.0,MR:0.5,NOISE:1.0,SNIPER:0.0"
        if (activeRound.botConfig) {
          options.botConfig = activeRound.botConfig;
          setLogs(prev => [...prev, { t: 'sys', msg: `[SIM] Bot config: ${activeRound.botConfig}` }]);
        } else if (activeRound.activeBots) {
          // Legacy: activeBots is an array of bot names to enable at scale 1.0
          const enabled = new Set((activeRound.activeBots || []).map(b => b.toUpperCase()));
          const parts = ['MM','MOM','MR','NOISE','SNIPER'].map(k => `${k}:${enabled.has(k) ? '1.0' : '0.0'}`);
          options.botConfig = parts.join(',');
          setLogs(prev => [...prev, { t: 'sys', msg: `[SIM] Bot config (from activeBots): ${options.botConfig}` }]);
        }
        // Dataset: try IDB key first, else fetch CSV from backend
        if (activeRound.testDataKey) {
          options.datasetKey = activeRound.testDataKey;
        } else if (activeRound.id) {
          // Try to load dataset from backend for this round and cache in IDB
          try {
            const dsRes = await fetch((import.meta.env.VITE_API_URL || '') + `/api/rounds/${activeRound.id}/dataset`);
            if (dsRes.ok) {
              const dsText = await dsRes.text();
              const key = `round_${activeRound.id}`;
              // Open IDB and store
              const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open('VidhiDatasets', 1);
                req.onupgradeneeded = e => e.target.result.createObjectStore('datasets');
                req.onsuccess = e => resolve(e.target.result);
                req.onerror = reject;
              });
              await new Promise((resolve, reject) => {
                const tx = db.transaction('datasets', 'readwrite');
                tx.objectStore('datasets').put(dsText, key);
                tx.oncomplete = resolve;
                tx.onerror = reject;
              });
              options.datasetKey = key;
              setLogs(prev => [...prev, { t: 'sys', msg: `[SIM] Loaded round dataset from backend (${dsText.length.toLocaleString()} bytes)` }]);
            }
          } catch (_e) {
            setLogs(prev => [...prev, { t: 'sys', msg: '[SIM] No custom dataset — using default GBM price signal' }]);
          }
        }
        // Custom bots uploaded by GM
        if (activeRound.activeBots) {
          const customBots = (activeRound.activeBots || [])
            .map(id => ContestStore.state.customBots?.find(b => b.id === id))
            .filter(b => b && b.code); // only custom Python bots with code
          if (customBots.length > 0) {
            options.customBots = customBots;
            setLogs(prev => [...prev, { t: 'sys', msg: `[SIM] ${customBots.length} custom bot(s) loaded` }]);
          }
        }
      }
    }

    await VidhiEngine.startSimulation(codeToRun, options);
    setTimeout(() => navigate('/simulation'), 400);
  };



  const handleStop = () => {
    VidhiEngine.stopSimulation();
    setLogs(prev => [...prev, { t: 'sys', msg: '[SYS] Simulation halted by user.' }]);
  };

  const isRunning = status === 'running' || status === 'compiling';

  const logColor = (t) => {
    if (t === 'done' || t === 'running') return 'var(--neon-green)';
    if (t === 'error') return 'var(--neon-red)';
    if (t === 'compiling') return 'var(--brand-blue)';
    return 'var(--text-muted)';
  };

  return (
    <div 
      className="tv-slide-in" 
      style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-core)', position: 'relative' }}
      onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false); }}
      onDrop={async (e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        processFile(file);
      }}
    >
      {isDragging && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          backdropFilter: 'blur(4px)',
          border: '2px dashed #10b981',
          zIndex: 9999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: '#10b981', fontFamily: "'Inter', sans-serif"
        }}>
          <FileText size={64} style={{ marginBottom: '16px' }} />
          <h2 style={{ fontSize: '2rem', margin: 0 }}>Drop trader.py here</h2>
        </div>
      )}
      
      {/* ── TICKER TAPE (ZEX Top Bar) ─────────────────────────────────────── */}
      <div className="premium-card" style={{ padding: 0, display: 'grid', gridTemplateRows: 'auto 1fr 220px', gap: '0', overflow: 'hidden' }}>

        {/* Editor header */}
        <div style={{ backgroundColor: 'var(--panel-bg)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-glass)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-bright)', fontFamily: "'Roboto Mono', monospace", fontSize: '0.8rem', letterSpacing: '1px' }}>
              <FileText size={14} /> trader.py
            </div>
            {/* Mode badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '2px 8px',
              backgroundColor: mode === 'backend' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
              border: `1px solid ${mode === 'backend' ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
              fontSize: '0.6rem', fontFamily: "'Roboto Mono', monospace",
              color: mode === 'backend' ? '#10b981' : '#f59e0b'
            }}>
              {mode === 'backend' ? <Wifi size={10} /> : <WifiOff size={10} />}
              {mode === 'backend' ? 'BACKEND' : 'LOCAL SIM'}
            </div>
            {/* Run ID (when active) */}
            {runId && (
              <div style={{ fontSize: '0.6rem', fontFamily: "'Roboto Mono', monospace", color: '#444' }}>
                {runId.slice(0, 20)}...
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', fontFamily: "'Roboto Mono', monospace" }}>
              <Cpu size={12} />
              <span style={{ color: isRunning ? 'var(--brand-cyan)' : status === 'done' ? '#10b981' : '#555' }}>
                {isRunning ? '● RUNNING' : status === 'done' ? '✓ DONE' : '○ IDLE'}
              </span>
            </div>
            {isRunning ? (
              <button className="btn-danger" onClick={handleStop} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Square size={12} fill="currentColor" /> STOP
              </button>
            ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', background: 'transparent', border: '1px solid #10b981', color: '#10b981', cursor: 'pointer', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                <FileText size={12} style={{ marginRight: '4px' }} /> UPLOAD .PY
                <input type="file" accept=".py" style={{ display: 'none' }} onChange={async (e) => {
                  const file = e.target.files[0];
                  if (file) {
                    processFile(file);
                    e.target.value = '';
                  }
                }} />
              </label>
              <button className="btn-primary" onClick={handleDeploy} style={{ padding: '6px 16px', borderRadius: '4px' }}>
                <Play size={12} fill="currentColor" /> DEPLOY ALGO
              </button>
            </div>
          )}
        </div>
        </div>

        {/* Monaco Editor */}
        <div style={{ backgroundColor: 'var(--panel-bg)', position: 'relative' }}>
          <Editor
            height="100%"
            defaultLanguage="python"
            theme="vs-dark"
            value={code}
            onChange={val => setCode(val || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'Roboto Mono', monospace",
              padding: { top: 16 },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              renderLineHighlight: 'gutter',
              lineNumbers: 'on',
            }}
          />
        </div>

        {/* Console */}
        <div style={{ backgroundColor: 'var(--panel-bg)', display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border-glass)' }}>
          <div style={{ padding: '4px 12px', backgroundColor: 'var(--panel-bg-hover)', borderBottom: '1px solid var(--border-glass)', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-dim)', fontSize: '0.65rem', fontFamily: "'Roboto Mono', monospace" }}>
            <TerminalSquare size={11} /> ARENA CONSOLE
            <span style={{ marginLeft: 'auto', color: '#444' }}>5 BOTS ACTIVE</span>
          </div>
          <div ref={consoleRef} style={{ flex: 1, padding: '10px 14px', overflowY: 'auto', fontFamily: "'Roboto Mono', monospace", fontSize: '0.72rem', lineHeight: 1.6, color: '#737373', display: 'flex', flexDirection: 'column', gap: '1px' }}>
            {logs.map((log, i) => (
              <div key={i} style={{ color: logColor(log.t) }}>{log.msg}</div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT: SDK Docs ────────────────────────────────────────────── */}
      <div className="premium-card" style={{ padding: 0, display: 'flex', flexDirection: 'column', gap: '0', overflowY: 'auto' }}>

        {/* Permanent Visual Drop Zone */}
        <div 
          style={{ 
            margin: '16px', padding: '24px', 
            border: '2px dashed var(--brand-cyan)', borderRadius: '8px',
            backgroundColor: 'rgba(0,255,102,0.05)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'all 0.2s',
            textAlign: 'center'
          }}
          onClick={() => document.getElementById('py-upload-input-zone').click()}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0,255,102,0.1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0,255,102,0.05)'; }}
        >
          {uploadingFile ? (
            <>
              <Loader className="tv-spin" size={24} style={{ color: 'var(--brand-cyan)', marginBottom: '8px' }} />
              <div style={{ color: 'var(--brand-cyan)', fontFamily: "'Inter', sans-serif", fontSize: '0.9rem', fontWeight: 600, marginBottom: '4px' }}>
                ANALYZING {uploadingFile.toUpperCase()}
              </div>
              <div style={{ color: 'var(--brand-cyan)', fontFamily: "'Roboto Mono', monospace", fontSize: '0.65rem', opacity: 0.8 }}>
                Preparing deployment...
              </div>
            </>
          ) : (
            <>
              <FileText size={24} style={{ color: 'var(--brand-cyan)', marginBottom: '8px' }} />
              <div style={{ color: 'var(--text-bright)', fontFamily: "'Inter', sans-serif", fontSize: '0.9rem', fontWeight: 600, marginBottom: '4px' }}>
                DRAG & DROP .PY FILE
              </div>
              <div style={{ color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", fontSize: '0.65rem' }}>
                It will auto-deploy instantly
              </div>
            </>
          )}
          <input id="py-upload-input-zone" type="file" accept=".py" style={{ display: 'none' }} onChange={async (e) => {
            const file = e.target.files[0];
            if (file) {
              processFile(file);
              e.target.value = '';
            }
          }} />
        </div>

        {/* SDK header */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-glass)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Zap size={14} color="var(--brand-cyan)" />
            <span style={{ color: 'var(--text-bright)', fontFamily: "'Roboto Mono', monospace", fontSize: '0.75rem', letterSpacing: '2px' }}>VIDHI SDK v5</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.6, margin: 0 }}>
            Your <code style={{ color: 'var(--brand-cyan)', fontSize: '0.75rem' }}>on_tick(state, orders)</code> runs once per tick against a live LOB. Bots react to your orders on the next tick.
          </p>
        </div>

        {/* State fields */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-glass)' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', fontFamily: "'Roboto Mono', monospace", letterSpacing: '1.5px', marginBottom: '10px' }}>STATE OBJECT</div>
          {[
            ['bid_price / ask_price', 'Best bid/ask in live LOB'],
            ['spread', 'Widens when market maker scared'],
            ['position', 'Your net long/short position'],
            ['cash', 'Current cash balance'],
            ['pnl', 'Mark-to-market PnL'],
            ['fills', 'List of fills from last tick'],
            ['ema_fast / ema_slow', 'Persistent state across ticks'],
          ].map(([k, v]) => (
            <div key={k} style={{ marginBottom: '8px' }}>
              <div style={{ color: 'var(--brand-cyan)', fontFamily: "'Roboto Mono', monospace", fontSize: '0.72rem' }}>state.{k}</div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', paddingLeft: '8px' }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Orders API */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-glass)' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', fontFamily: "'Roboto Mono', monospace", letterSpacing: '1.5px', marginBottom: '10px' }}>ORDERS API</div>
          {[
            'orders.limit_buy(price, vol)',
            'orders.limit_sell(price, vol)',
            'orders.market_buy(vol)',
            'orders.market_sell(vol)',
            'orders.cancel(order_id)',
          ].map(o => (
            <div key={o} style={{ color: 'var(--brand-cyan)', fontFamily: "'Roboto Mono', monospace", fontSize: '0.72rem', marginBottom: '6px' }}>{o}</div>
          ))}
          <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '6px' }}>Max 4 orders per tick. Position limit ±1000.</div>
        </div>

        {/* Bot roster */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-glass)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-dim)', fontSize: '0.65rem', fontFamily: "'Roboto Mono', monospace", letterSpacing: '1.5px', marginBottom: '12px' }}>
            <Bot size={11} /> YOUR OPPONENTS
          </div>
          {BOT_DOCS.map(b => (
            <div key={b.name} style={{ marginBottom: '12px' }}>
              <div style={{ color: b.color, fontFamily: "'Roboto Mono', monospace", fontSize: '0.72rem', fontWeight: 700 }}>{b.name}</div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', lineHeight: 1.5 }}>{b.desc}</div>
            </div>
          ))}
        </div>

        {/* Warning */}
        <div style={{ margin: '16px', padding: '12px', border: '1px solid var(--border-light)', backgroundColor: 'var(--panel-bg-hover)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--neon-red)', fontSize: '0.7rem', fontFamily: "'Roboto Mono', monospace", marginBottom: '6px' }}>
            <AlertTriangle size={12} /> SANDBOX RULES
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', margin: 0, lineHeight: 1.5 }}>
            No imports. No I/O. No loops that run forever. Position limit ±1000. Violation = disqualification.
          </p>
        </div>
      </div>
    </div>
  );
}
