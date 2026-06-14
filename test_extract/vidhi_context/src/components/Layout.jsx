import React, { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Terminal, Activity, Trophy, Database, History, Cpu, Zap, Box, Bot, Layers, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import VidhiEngine from '../engine/VidhiEngine';
import ContestStore from '../store/ContestStore';

const AnimatedValue = ({ value, className, colorType = 'white' }) => {
  const [flash, setFlash] = useState(false);
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current !== value) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 300);
      prevValue.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);

  const flashClass = flash ? (colorType === 'blue' ? 'tv-flash-blue-active' : 'tv-flash-active') : '';
  return <span className={`tv-value ${flashClass} ${className || ''}`}>{value}</span>;
};

export default function Layout() {
  const location = useLocation();
  const [sim, setSim] = useState(null);
  const [status, setStatus] = useState('idle');
  const [storeState, setStore] = useState(ContestStore.state);
  const [mode, setMode] = useState(VidhiEngine.getMode());
  const [health, setHealth] = useState({ db: false, redis: false, worker: false });
  const [correctness, setCorrectness] = useState(null);

  useEffect(() => ContestStore.subscribe(s => setStore({ ...s })), []);

  const contest = ContestStore.getActiveContest();
  const activeRound = contest?.rounds?.find(r => r.status === 'active');

  useEffect(() => {
    const unsubTick = VidhiEngine.subscribe(data => setSim(data));
    const unsubStatus = VidhiEngine.onStatus((s, msg) => {
      setStatus(s);
      setMode(VidhiEngine.getMode());
    });
    const unsubComplete = VidhiEngine.onComplete(result => {
      if (result.correctness != null) setCorrectness(result.correctness);
    });

    // Poll /api/health every 15s for infra status
    async function pollHealth() {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const data = await res.json();
          setHealth({ db: data.db, redis: data.redis, worker: data.worker ?? false });
        }
      } catch (_e) { /* backend offline */ }
    }
    pollHealth();
    const hi = setInterval(pollHealth, 15_000);

    return () => {
      unsubTick();
      unsubStatus();
      unsubComplete();
      clearInterval(hi);
    };
  }, []);

  const isRunning = status === 'running' || status === 'compiling';
  const isDone = status === 'done';

  // Derive ticker items from live simulation state
  const tickerItems = sim ? [
    { sym: 'VIDHI-1', price: sim.bidPrice?.toFixed(2) ?? '---', chg: sim.pnlPct >= 0 ? `+${sim.pnlPct?.toFixed(3)}%` : `${sim.pnlPct?.toFixed(3)}%`, up: sim.pnlPct >= 0 },
    { sym: 'SPREAD', price: sim.spread?.toFixed(4) ?? '---', chg: sim.spread < 0.05 ? 'TIGHT' : 'WIDE', up: sim.spread < 0.05 },
    { sym: 'P99', price: sim.p99?.toFixed(0) + ' ns', chg: sim.p99 < 200 ? 'FAST' : 'SLOW', up: sim.p99 < 200 },
    { sym: 'FILLS', price: (sim.totalFills ?? 0).toLocaleString(), chg: '+' + (sim.totalFills ?? 0), up: true },
    { sym: 'POS', price: sim.position >= 0 ? `+${sim.position}` : `${sim.position}`, chg: sim.position === 0 ? 'FLAT' : sim.position > 0 ? 'LONG' : 'SHORT', up: sim.position >= 0 },
  ] : [
    { sym: 'VIDHI-1', price: '1500.00', chg: 'IDLE', up: true },
    { sym: 'BOT::MM', price: 'READY', chg: 'QUOTING', up: true },
    { sym: 'BOT::MOM', price: 'READY', chg: 'WATCHING', up: true },
    { sym: 'BOT::MR', price: 'READY', chg: 'WATCHING', up: true },
    { sym: 'BOT::SNIPER', price: 'READY', chg: 'ARMED', up: false },
  ];

  // Telemetry numbers
  const tick = sim?.tick ?? 0;
  const maxTicks = sim?.maxTicks ?? 100_000;
  const pnl = sim?.pnl ?? 0;
  const pnlPct = sim?.pnlPct ?? 0;
  const p99 = sim?.p99 ?? 0;
  const position = sim?.position ?? 0;
  const botTotal = sim ? Object.values(sim.botActivity || {}).reduce((a, b) => a + b, 0) : 0;

  const correctnessColor = correctness === null ? '#444'
    : correctness >= 0.95 ? 'var(--neon-green)'
      : correctness >= 0.80 ? '#FF9900'
        : 'var(--neon-red)';

  const DockItem = ({ to, icon, label }) => {
    const isActive = location.pathname === to;
    return (
      <Link to={to} className={`dock-icon ${isActive ? 'active' : ''}`} title={label}>
        {icon}
      </Link>
    );
  };

  const StatusDot = ({ on, label }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.6rem',
      fontFamily: "'Roboto Mono', monospace", color: on ? '#10b981' : '#444'
    }}>
      <div style={{
        width: 5, height: 5, borderRadius: '50%',
        backgroundColor: on ? '#10b981' : '#333',
        boxShadow: on ? '0 0 4px #10b981' : 'none'
      }} />
      {label}
    </div>
  );

  return (
    <div className="command-center-layout">

      {/* 1. Top Navigation Bar */}
      <div className="top-navbar">
        <Link to="/lobby" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
          <img src="/logo.png" alt="Project Vidhi" className="brand-logo" />
        </Link>
        <div className="navbar-user-section">
          {mode === 'backend' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#A3A3A3', fontSize: '0.75rem', fontFamily: "'Roboto Mono', monospace" }}>
              <Wifi size={14} color="#00C6FF" /> CONNECTED TO GM
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#A3A3A3', fontSize: '0.75rem', fontFamily: "'Roboto Mono', monospace" }}>
              <WifiOff size={14} /> LOCAL WORKER
            </div>
          )}
          <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-glass)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '4px', background: 'var(--brand-gradient)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.8rem', fontWeight: 600
            }}>
              {(storeState.studentName || 'U')[0].toUpperCase()}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-bright)', fontWeight: 500 }}>
              {storeState.studentName || 'Contestant'}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Left Dock */}
      <div className="layout-dock">
        <div style={{ marginBottom: '24px' }}>
          <Link to="/lobby" title="Contest Lobby" style={{ display: 'block', lineHeight: 0 }}>
            <Zap size={22} color={isRunning ? 'var(--brand-cyan)' : 'var(--text-bright)'}
              style={{ filter: isRunning ? 'drop-shadow(0 0 6px var(--brand-cyan))' : 'none', transition: 'filter 0.3s' }} />
          </Link>
        </div>
        <DockItem to="/" icon={<Terminal size={18} />} label="Code Arena" />
        <DockItem to="/simulation" icon={<Activity size={18} />} label="Simulation" />
        <DockItem to="/leaderboard" icon={<Trophy size={18} />} label="Leaderboard" />
        <div style={{ width: '20px', height: '1px', backgroundColor: 'var(--border-glass)', margin: '4px 0' }} />
        <DockItem to="/assets" icon={<Database size={18} />} label="Asset Wiki" />
        <DockItem to="/history" icon={<History size={18} />} label="Submissions" />
      </div>

      {/* 3. Center */}
      <div className="layout-center">
        <Outlet />
      </div>

      {/* 4. Telemetry Sidebar */}
      <div className="layout-telemetry">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.5rem', color: 'var(--text-bright)' }}>
          <Box size={14} />
          <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '0.72rem', letterSpacing: '2px' }}>TELEMETRY</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              backgroundColor: isRunning ? 'var(--brand-cyan)' : isDone ? '#10b981' : '#333',
              boxShadow: isRunning ? '0 0 6px var(--brand-cyan)' : 'none',
              animation: isRunning ? 'pulse 1s infinite alternate' : 'none'
            }} />
            <span style={{
              fontSize: '0.6rem', color: isRunning ? 'var(--brand-cyan)' : isDone ? '#10b981' : '#444',
              fontFamily: "'Roboto Mono', monospace"
            }}>
              {isRunning ? 'LIVE' : isDone ? 'DONE' : 'IDLE'}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="premium-card telemetry-block tv-slide-in" style={{ animationDelay: '0.1s', marginBottom: '1rem' }}>
          <div className="telemetry-header">SIMULATION PROGRESS</div>
          <div style={{ fontSize: '1rem', color: 'var(--text-bright)', fontFamily: "'Roboto Mono', monospace", fontWeight: 500, marginBottom: '6px' }}>
            <AnimatedValue value={tick.toLocaleString()} colorType="blue" /> / {maxTicks.toLocaleString()}
          </div>
          <div className="telemetry-bar">
            <div className="telemetry-fill" style={{
              width: `${(tick / maxTicks) * 100}%`,
              backgroundColor: isDone ? 'var(--neon-green)' : 'var(--brand-cyan)', transition: 'width 0.2s'
            }} />
          </div>
        </div>

        {/* PnL */}
        <div className="premium-card telemetry-block tv-slide-in" style={{ animationDelay: '0.2s', marginBottom: '1rem' }}>
          <div className="telemetry-header">PnL</div>
          <div style={{
            fontFamily: "'Roboto Mono', monospace", fontSize: '1.1rem', fontWeight: 700,
            color: pnl >= 0 ? 'var(--neon-green)' : 'var(--neon-red)'
          }}>
            <AnimatedValue value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}`} colorType="white" />
          </div>
          <div style={{
            fontFamily: "'Roboto Mono', monospace", fontSize: '0.75rem',
            color: pnlPct >= 0 ? 'var(--neon-green)' : 'var(--neon-red)', marginTop: '2px'
          }}>
            <AnimatedValue value={`${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(4)}%`} colorType="white" />
          </div>
        </div>

        {/* Position */}
        <div className="premium-card telemetry-block tv-slide-in" style={{ animationDelay: '0.3s', marginBottom: '1rem' }}>
          <div className="telemetry-header">NET POSITION</div>
          <div style={{
            fontFamily: "'Roboto Mono', monospace", fontSize: '1.1rem', fontWeight: 500,
            color: position > 0 ? 'var(--neon-green)' : position < 0 ? 'var(--neon-red)' : '#555'
          }}>
            <AnimatedValue value={`${position > 0 ? '+' : ''}${position}`} colorType="white" />
          </div>
          <div className="telemetry-bar" style={{ marginTop: '6px' }}>
            <div style={{
              height: '100%', transition: 'width 0.3s',
              width: `${Math.abs(position) / 10}%`,
              backgroundColor: position > 0 ? 'var(--neon-green)' : position < 0 ? 'var(--neon-red)' : '#333'
            }} />
          </div>
        </div>

        {/* Latency */}
        <div className="premium-card telemetry-block tv-slide-in" style={{ animationDelay: '0.4s', marginBottom: '1rem' }}>
          <div className="telemetry-header">P99 LATENCY</div>
          <div style={{
            fontFamily: "'Roboto Mono', monospace", fontSize: '1.1rem', fontWeight: 500,
            color: p99 > 0 ? (p99 < 200 ? 'var(--neon-green)' : '#FF9900') : '#555'
          }}>
            <AnimatedValue value={p99 > 0 ? `${p99.toFixed(0)} ns` : '---'} />
          </div>
        </div>

        {/* Bot activity */}
        <div className="premium-card telemetry-block tv-slide-in" style={{ animationDelay: '0.5s', marginBottom: '1rem' }}>
          <div className="telemetry-header">BOT FILLS</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Bot size={12} color="#555" />
            <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '1rem', color: '#666' }}>
              <AnimatedValue value={botTotal.toLocaleString()} />
            </span>
          </div>
        </div>

        {/* Correctness score (from last completed backend run) */}
        {correctness !== null && (
          <div className="premium-card telemetry-block" style={{ marginBottom: '1rem' }}>
            <div className="telemetry-header">CORRECTNESS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={12} color={correctnessColor} />
              <span style={{
                fontFamily: "'Roboto Mono', monospace", fontSize: '1rem',
                fontWeight: 700, color: correctnessColor
              }}>
                {correctness.toFixed(4)}
              </span>
            </div>
            <div style={{ fontSize: '0.6rem', color: correctnessColor, fontFamily: "'Roboto Mono', monospace", marginTop: '3px' }}>
              {correctness >= 0.95 ? '● SHADOW LOB CLEAN'
                : correctness >= 0.80 ? '⚠ WARNINGS'
                  : '✗ VIOLATIONS'}
            </div>
          </div>
        )}

        {/* Contest context */}
        {contest && (
          <div className="premium-card telemetry-block" style={{ marginBottom: '1rem' }}>
            <div className="telemetry-header">CONTEST</div>
            <div style={{
              fontFamily: "'Roboto Mono', monospace", fontSize: '0.7rem',
              color: 'var(--text-bright)', lineHeight: 1.4
            }}>
              {(contest.name || '').length > 18 ? (contest.name || '').substring(0, 18) + '…' : (contest.name || 'Unknown')}
            </div>
            {activeRound && (
              <div style={{
                fontFamily: "'Roboto Mono', monospace", fontSize: '0.6rem',
                color: '#a855f7', marginTop: '4px'
              }}>
                {(activeRound.name || '').split('—')[0].trim()}
              </div>
            )}
          </div>
        )}

        {/* Backend infrastructure status */}
        <div className="premium-card telemetry-block" style={{ marginTop: 'auto', marginBottom: '1rem' }}>
          <div className="telemetry-header" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {mode === 'backend' ? <Wifi size={10} /> : <WifiOff size={10} />}
            INFRA STATUS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '6px' }}>
            <StatusDot on={mode === 'backend'} label={mode === 'backend' ? 'BACKEND ONLINE' : 'LOCAL SIM'} />
            <StatusDot on={health.db} label="POSTGRES" />
            <StatusDot on={health.redis} label="REDIS" />
            <StatusDot on={health.worker} label="JOB WORKER" />
          </div>
        </div>
      </div>
    </div>
  );
}


