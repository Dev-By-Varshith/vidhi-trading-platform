import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Activity, Cpu, Zap, TrendingUp, TrendingDown, Bot, BarChart2, Layers, CheckCircle2, Trophy, Download } from 'lucide-react';
import VidhiEngine from '../engine/VidhiEngine';
import ContestStore from '../store/ContestStore';
import { downloadRunLog } from '../api/client';

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

// ─── Mini chart (canvas-based, zero dependencies) ─────────────────────────────
function SparkLine({ data, color, height = 60, fill = true, glow = true }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const vals = data.map(d => (typeof d === 'object' ? d.pnl : d));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const toY = v => h - ((v - min) / range) * (h - 16) - 8; // More padding for glows
    const toX = i => (i / (vals.length - 1)) * w;

    // Gradient fill
    if (fill) {
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(vals[0]));
      for (let i = 1; i < vals.length; i++) ctx.lineTo(toX(i), toY(vals[i]));
      ctx.lineTo(toX(vals.length - 1), h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, color.replace(')', ', 0.35)').replace('rgb', 'rgba').replace('#00FF66', 'rgba(0,255,102,0.35)').replace('#FF2A4B', 'rgba(255,42,75,0.35)'));
      grad.addColorStop(1, color.replace(')', ', 0)').replace('rgb', 'rgba').replace('#00FF66', 'rgba(0,255,102,0)').replace('#FF2A4B', 'rgba(255,42,75,0)'));
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Glow effect
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(vals[0]));
    for (let i = 1; i < vals.length; i++) ctx.lineTo(toX(i), toY(vals[i]));

    if (glow) {
      ctx.shadowBlur = 12;
      ctx.shadowColor = color;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Reset shadow
    ctx.shadowBlur = 0;

    // Glowing dot at the end
    const lastX = toX(vals.length - 1);
    const lastY = toY(vals[vals.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 10;
    ctx.shadowColor = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }, [data, color, fill, glow]);

  return <canvas ref={ref} width={300} height={height} style={{ width: '100%', height }} />;
}

// ─── ZEX-Style LOB Depth Visualizer ──────────────────────────────────────────
function LOBDepthBar({ bidDepth = [], askDepth = [] }) {
  const maxVol = Math.max(
    ...bidDepth.map(d => d.volume),
    ...askDepth.map(d => d.volume),
    1
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontFamily: "'Roboto Mono', monospace", fontSize: '0.75rem' }}>
      {/* Ask side (top, reversed) */}
      {[...askDepth].reverse().map((level, i) => (
        <div key={`ask-${i}`} className="lob-row">
          <div className="lob-bg" style={{ right: 0, width: `${(level.volume / maxVol) * 100}%`, backgroundColor: 'var(--neon-red)' }} />
          <div className="lob-content">
            <span style={{ color: 'var(--neon-red)' }}>{level.price?.toFixed(2)}</span>
            <span style={{ color: 'var(--text-bright)' }}>{level.volume}</span>
          </div>
        </div>
      ))}
      {/* Spread line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' }}>
        <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-glass)' }} />
        <span style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>SPREAD</span>
        <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-glass)' }} />
      </div>
      {/* Bid side */}
      {bidDepth.map((level, i) => (
        <div key={`bid-${i}`} className="lob-row">
          <div className="lob-bg" style={{ right: 0, width: `${(level.volume / maxVol) * 100}%`, backgroundColor: 'var(--neon-green)' }} />
          <div className="lob-content">
            <span style={{ color: 'var(--neon-green)' }}>{level.price?.toFixed(2)}</span>
            <span style={{ color: 'var(--text-bright)' }}>{level.volume}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Bot Activity Bar ─────────────────────────────────────────────────────────
function BotActivityRow({ name, fills, total, color }) {
  const pct = total > 0 ? (fills / total) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
      <div style={{ width: '72px', fontSize: '0.7rem', fontFamily: "'Roboto Mono', monospace", color: '#666' }}>{name}</div>
      <div style={{ flex: 1, height: '6px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: '3px', transition: 'width 0.3s' }} />
      </div>
      <div style={{ width: '36px', textAlign: 'right', fontSize: '0.7rem', fontFamily: "'Roboto Mono', monospace", color: '#555' }}>{fills}</div>
    </div>
  );
}

// ─── Premium Card Wrapper ────────────────────────────────────────────────────────────
function Panel({ title, icon, children, style = {}, delay = '0s' }) {
  return (
    <div className="premium-card tv-slide-in" style={{ animationDelay: delay, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-dim)', fontSize: '0.65rem', fontFamily: "'Inter', sans-serif", letterSpacing: '0.5px', fontWeight: 500 }}>
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

// ─── Stat cell ────────────────────────────────────────────────────────────────
function Stat({ label, value, color = 'var(--text-bright)', mono = true }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", letterSpacing: '1px', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color, fontFamily: mono ? "'Roboto Mono', monospace" : 'inherit' }}>
        <AnimatedValue value={value} />
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function SimulationDashboard() {
  const [state, setState] = useState(VidhiEngine.getLastState() || null);
  const [done, setDone] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [mode, setMode] = useState(VidhiEngine.getMode());
  // N3: Position history ring for position chart (300 samples)
  const posHistory = useRef([]);
  const [posSnap, setPosSnap] = useState([]);

  const handleSubmitScore = () => {
    if (!state || submitted) return;
    const storeState = ContestStore.state;
    if (storeState.activeContestId) {
      ContestStore.recordResult({
        contestId: storeState.activeContestId,
        roundId: ContestStore.getActiveContest()?.rounds?.find(r => r.status === 'active')?.id,
        pnlPct: state.pnlPct ?? 0,
        p99: state.p99 ?? 0,
        p50: state.p50 ?? 0,
        fills: state.totalFills ?? state.total_fills ?? 0,
      });
      setSubmitted(true);
    }
  };

  const handleDownloadCode = () => {
    if (!state?.code) return;
    const blob = new Blob([state.code], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `submission.py`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const [downloadingLog, setDownloadingLog] = useState(false);
  const handleDownloadLogs = async () => {
    // If we have activitiesLog directly in state (from Local Sim Worker)
    if (state?.activitiesLog) {
      const blob = new Blob([JSON.stringify({
        submissionId: 'local_sim_' + Date.now(),
        activitiesLog: state.activitiesLog
      })], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `local_sim.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

    // state.runId may be mapped as runId (or state.run_id directly from raw payload)
    const runId = state?.runId || state?.run_id;
    if (!runId) {
      alert("No Run ID found. Are you running a local sim without logs?");
      return;
    }
    setDownloadingLog(true);
    try {
      await downloadRunLog(runId);
    } catch (e) {
      alert("Failed to download logs: " + e.message);
    } finally {
      setDownloadingLog(false);
    }
  };

  useEffect(() => {
    const unsubTick = VidhiEngine.subscribe(data => {
      setState(data);
      if (data.done) setDone(true);
      // Track position history ring (N3)
      if (typeof data.position === 'number') {
        posHistory.current = [...posHistory.current, data.position];
        if (posHistory.current.length > 300) posHistory.current.shift();
        setPosSnap([...posHistory.current]);  // trigger re-render for chart
      }
    });
    const unsubDone = VidhiEngine.onComplete((result) => {
      setDone(true);
      setState(prev => ({ ...(prev || {}), ...result, done: true }));
    });
    const unsubStatus = VidhiEngine.onStatus(() => {
      setMode(VidhiEngine.getMode());
    });
    return () => { unsubTick(); unsubDone(); unsubStatus(); };
  }, []);

  const idle = !state || state.tick === 0;
  const pnlPositive = (state?.pnl ?? 0) >= 0;
  const botTotal = state ? Object.values(state.botActivity || {}).reduce((a, b) => a + b, 0) : 0;
  const correctness = state?.correctness ?? null;
  const correctnessColor = correctness === null ? '#555'
    : correctness >= 0.95 ? '#10b981'
      : correctness >= 0.80 ? '#f59e0b'
        : '#e11d48';

  const BOT_COLORS = {
    MM: 'var(--brand-cyan)', MOM: 'var(--brand-blue)', MR: '#f59e0b', NOISE: '#6b7280', SNIPER: '#e11d48'
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: 'var(--bg-core)' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-bright)', fontFamily: "'Roboto Mono', monospace", fontSize: '0.8rem', letterSpacing: '2px' }}>
          <Zap size={16} style={{ color: idle ? '#333' : 'var(--brand-cyan)' }} />
          SIMULATION DASHBOARD
          {/* Mode badge */}
          <span style={{
            fontSize: '0.6rem', padding: '2px 7px',
            backgroundColor: mode === 'backend' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.08)',
            border: `1px solid ${mode === 'backend' ? '#10b98140' : '#f59e0b40'}`,
            color: mode === 'backend' ? '#10b981' : '#f59e0b', letterSpacing: '1px'
          }}>
            {mode === 'backend' ? 'BACKEND' : 'LOCAL'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '20px', fontSize: '0.75rem', fontFamily: "'Roboto Mono', monospace" }}>
          <span style={{ color: 'var(--text-dim)' }}>TICK</span>
          <span style={{ color: 'var(--text-bright)' }}>{(state?.tick ?? 0).toLocaleString()} / {(state?.maxTicks ?? 100000).toLocaleString()}</span>
          <span style={{ display: 'inline-block', width: '80px', height: '6px', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: '3px', overflow: 'hidden', alignSelf: 'center' }}>
            <span style={{ display: 'block', height: '100%', width: `${((state?.progress ?? 0) * 100).toFixed(1)}%`, backgroundColor: done ? '#10b981' : 'var(--brand-cyan)', transition: 'width 0.2s', borderRadius: '3px' }} />
          </span>
        </div>
      </div>

      {/* ── Top stats row (6 panels) ───────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
        <Panel title="PnL" icon={<TrendingUp size={12} />} delay="0.1s">
          <Stat label="Total" value={idle ? '---' : `${pnlPositive ? '+' : ''}${(state.pnl || 0).toFixed(2)}`} color={pnlPositive ? 'var(--neon-green)' : 'var(--neon-red)'} />
          <Stat label="PnL %" value={idle ? '---' : `${(state.pnlPct || 0).toFixed(3)}%`} color={pnlPositive ? 'var(--neon-green)' : 'var(--neon-red)'} />
        </Panel>
        <Panel title="Position" icon={<BarChart2 size={12} />} delay="0.2s">
          <Stat label="Net Pos" value={idle ? '---' : state.position > 0 ? `+${state.position}` : `${state.position}`} color={state?.position > 0 ? 'var(--neon-green)' : state?.position < 0 ? 'var(--neon-red)' : 'var(--text-bright)'} />
          <Stat label="Fills" value={idle ? '---' : (state.totalFills ?? 0).toLocaleString()} />
        </Panel>
        <Panel title="LOB" icon={<Layers size={12} />} delay="0.3s">
          <Stat label="Best Bid" value={idle ? '---' : `$${(state.bidPrice || 0).toFixed(2)}`} color="var(--neon-green)" />
          <Stat label="Best Ask" value={idle ? '---' : `$${(state.askPrice || 0).toFixed(2)}`} color="var(--neon-red)" />
        </Panel>
        <Panel title="Spread" icon={<Activity size={12} />} delay="0.4s">
          <Stat label="Spread" value={idle ? '---' : `$${(state.spread || 0).toFixed(4)}`} />
          <Stat label="Last Trade" value={idle ? '---' : `$${(state.lastTrade || 0).toFixed(2)}`} />
        </Panel>
        <Panel title="Latency" icon={<Cpu size={12} />} delay="0.5s">
          <Stat label="p50" value={idle ? '---' : `${(state.p50 || 0).toFixed(0)} ns`} />
          <Stat label="p99" value={idle ? '---' : `${(state.p99 || 0).toFixed(0)} ns`} color={state?.p99 > 1000 ? '#FF9900' : 'var(--neon-green)'} />
        </Panel>
        <Panel title="Correctness" icon={<Activity size={12} />} delay="0.6s">
          <Stat
            label="LOB Score"
            value={correctness !== null ? correctness.toFixed(3) : mode === 'backend' ? '...' : 'N/A'}
            color={correctnessColor}
          />
          <div style={{ fontSize: '0.6rem', color: correctnessColor, fontFamily: "'Roboto Mono', monospace" }}>
            <AnimatedValue value={correctness === null ? (mode === 'backend' ? 'shadow book' : 'backend only')
              : correctness >= 0.95 ? '● VALID'
                : correctness >= 0.80 ? '⚠ WARNINGS'
                  : '✗ VIOLATIONS'} />
          </div>
        </Panel>
      </div>

      {/* ── PnL curve + LOB depth ──────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
        <Panel title="PnL Curve — Live" icon={<TrendingUp size={12} />} style={{ minHeight: '160px' }}>
          {idle ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', fontFamily: "'Roboto Mono', monospace", textAlign: 'center', paddingTop: '40px' }}>
              Run a simulation to see PnL curve
            </div>
          ) : (
            <SparkLine data={state.pnlHistory ?? []} color={pnlPositive ? '#00FF66' : '#FF2A4B'} height={100} glow={true} />
          )}
        </Panel>
        <Panel title="LOB Depth — Live" icon={<Layers size={12} />}>
          {idle ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', fontFamily: "'Roboto Mono', monospace" }}>Awaiting simulation...</div>
          ) : (
            <LOBDepthBar bidDepth={state.bidDepth ?? []} askDepth={state.askDepth ?? []} />
          )}
        </Panel>
      </div>

      {/* ── Position chart (N3) ────────────────────────────────────────── */}
      <Panel title="Position Over Time" icon={<BarChart2 size={12} />} style={{ minHeight: '120px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem', fontFamily: "'Roboto Mono', monospace" }}>NET POSITION</span>
          <span style={{
            color: (state?.position ?? 0) > 0 ? '#10b981' : (state?.position ?? 0) < 0 ? '#e11d48' : 'var(--text-dim)',
            fontFamily: "'Roboto Mono', monospace", fontSize: '0.9rem', fontWeight: 700,
          }}>
            {idle ? '---' : (state.position > 0 ? '+' : '') + state.position}
          </span>
          <span style={{ color: '#333', fontSize: '0.6rem', fontFamily: "'Roboto Mono', monospace", marginLeft: 'auto' }}>
            ±1000 LIMIT
          </span>
          {/* position limit guide lines at ±100% */}
        </div>
        {posSnap.length < 2 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', fontFamily: "'Roboto Mono', monospace", textAlign: 'center', paddingTop: '24px' }}>
            Position chart populates as ticks stream in...
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <SparkLine
              data={posSnap}
              color={(state?.position ?? 0) >= 0 ? '#00FF66' : '#FF2A4B'}
              height={80}
              fill={true}
              glow={true}
            />
            {/* zero line */}
            <div style={{
              position: 'absolute', left: 0, right: 0,
              top: `${(() => {
                const min = Math.min(...posSnap);
                const max = Math.max(...posSnap);
                const range = max - min || 1;
                const zero = Math.max(0, Math.min(1, -min / range));
                return (1 - zero) * 80;
              })()}px`,
              height: '1px', backgroundColor: 'rgba(255,255,255,0.1)', pointerEvents: 'none',
            }} />
          </div>
        )}
      </Panel>

      {/* ── Bot activity ──────────────────────────────────────────────────── */}
      <Panel title="Bot Activity — Fill Count" icon={<Bot size={12} />}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
          <div>
            <BotActivityRow name="MKT MAKER" fills={state?.botActivity?.MM ?? 0} total={botTotal} color="var(--brand-cyan)" />
            <BotActivityRow name="MOMENTUM" fills={state?.botActivity?.MOM ?? 0} total={botTotal} color="var(--brand-blue)" />
            <BotActivityRow name="MEAN REV" fills={state?.botActivity?.MR ?? 0} total={botTotal} color="#f59e0b" />
          </div>
          <div>
            <BotActivityRow name="NOISE" fills={state?.botActivity?.NOISE ?? 0} total={botTotal} color="#6b7280" />
            <BotActivityRow name="SNIPER" fills={state?.botActivity?.SNIPER ?? 0} total={botTotal} color="#e11d48" />
            <div style={{ marginTop: '8px', fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace" }}>
              TOTAL BOT FILLS: {botTotal.toLocaleString()}
            </div>
          </div>
        </div>
      </Panel>

      {/* ── Done banner ───────────────────────────────────────────────────── */}
      {done && (
        <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: 'var(--text-bright)', fontSize: '0.8rem', fontFamily: "'Roboto Mono', monospace" }}>
            <span style={{ color: '#10b981' }}>✓ SIMULATION COMPLETE</span> — 100,000 TICKS PROCESSED
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
            <div style={{ display: 'flex', gap: '24px' }}>
              <Stat label="Final PnL" value={`$${(state?.pnl || 0).toFixed(2)}`} color={pnlPositive ? '#10b981' : '#e11d48'} />
              <Stat label="PnL %" value={`${(state?.pnlPct || 0).toFixed(4)}%`} color={pnlPositive ? '#10b981' : '#e11d48'} />
              <Stat label="p50" value={`${(state?.p50 || 0).toFixed(0)} ns`} color="var(--text-bright)" />
              <Stat label="p99" value={`${(state?.p99 || 0).toFixed(0)} ns`} color={state?.p99 > 1000 ? '#f59e0b' : '#10b981'} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button onClick={handleDownloadCode} style={{
                backgroundColor: 'transparent', color: 'var(--text-bright)', border: '1px solid var(--border-light)', padding: '10px 20px',
                fontFamily: "'Inter', sans-serif", fontSize: '0.8rem', fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                transition: 'all 0.15s', borderRadius: '4px'
              }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'var(--text-bright)'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'var(--border-light)'; }}
              >
                <Download size={14} /> DOWNLOAD .PY
              </button>

              <button onClick={handleDownloadLogs} disabled={downloadingLog} style={{
                backgroundColor: 'transparent', color: 'var(--text-bright)', border: '1px solid var(--border-light)', padding: '10px 20px',
                fontFamily: "'Inter', sans-serif", fontSize: '0.8rem', fontWeight: 600,
                cursor: downloadingLog ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                transition: 'all 0.15s', opacity: downloadingLog ? 0.5 : 1, borderRadius: '4px'
              }}
                onMouseEnter={e => { if (!downloadingLog) { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'var(--text-bright)'; } }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'var(--border-light)'; }}
              >
                <Download size={14} /> {downloadingLog ? 'DOWNLOADING...' : 'DOWNLOAD .LOG'}
              </button>

              {submitted ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: '0.8rem', paddingLeft: '12px' }}>
                  <CheckCircle2 size={16} /> SUBMITTED
                </div>
              ) : (
                <button onClick={handleSubmitScore} className="btn-primary">
                  <Trophy size={14} /> SUBMIT SCORE
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
