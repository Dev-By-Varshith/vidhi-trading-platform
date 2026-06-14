import React, { useState, useEffect, useRef } from 'react';
import { History, Download, Play, CheckCircle2, XCircle, TrendingUp, TrendingDown, Bot, ShieldCheck, FileCode2 } from 'lucide-react';
import VidhiEngine from '../engine/VidhiEngine';
import { useNavigate } from 'react-router-dom';

// ─── Tiny canvas sparkline ────────────────────────────────────────────────────
function TinyChart({ history = [], color = '#10b981' }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || history.length < 2) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const vals = history.map(d => d.pnl ?? d);
    const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
    const toX = i => (i / (vals.length - 1)) * w;
    const toY = v => h - ((v - min) / range) * (h - 2) - 1;
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(vals[0]));
    for (let i = 1; i < vals.length; i++) ctx.lineTo(toX(i), toY(vals[i]));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [history, color]);
  return <canvas ref={ref} width={160} height={28} style={{ width: 160, height: 28 }} />;
}

export default function Submissions() {
  const [storeState, setStoreState] = useState(ContestStore.state);
  const [credits, setCredits] = useState(5);
  const navigate = useNavigate();

  useEffect(() => {
    return ContestStore.subscribe(s => setStoreState({ ...s }));
  }, []);

  const runs = storeState.mySubmissions || [];

  // Fetch credits on mount and after runs
  const fetchCredits = async () => {
    try {
      const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/credits');
      if (res.ok) {
        const data = await res.json();
        setCredits(data.remaining);
      }
    } catch (e) { console.warn('Failed to fetch credits:', e); }
  };

  useEffect(() => { fetchCredits(); }, []);

  const formatTime = (dateStr) => {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60)   return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  return (
    <div style={{ padding: '1.5rem', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <History size={18} color="var(--text-bright)" />
          <span style={{ color: 'var(--text-bright)', fontFamily: "'Roboto Mono', monospace",
            fontSize: '0.85rem', letterSpacing: '2px' }}>SUBMISSION HISTORY</span>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {/* Credit counter */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} style={{ width: 10, height: 10,
                backgroundColor: i < credits ? '#a855f7' : '#1a1a1a',
                border: '1px solid #333', borderRadius: '2px',
                boxShadow: i < credits ? '0 0 4px #a855f780' : 'none',
                transition: 'all 0.3s' }} />
            ))}
            <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem',
              fontFamily: "'Roboto Mono', monospace", marginLeft: '6px' }}>
              {credits}/5 DAILY RUNS
            </span>
          </div>
          <button className="btn-primary" onClick={() => navigate('/')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px' }}>
            <Play size={12} fill="currentColor" /> NEW RUN
          </button>
        </div>
      </div>

      {/* ── Empty state ────────────────────────────────────────────── */}
      {runs.length === 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: '16px', color: 'var(--text-dim)', paddingTop: '80px' }}>
          <History size={40} strokeWidth={1} />
          <div style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '0.8rem', letterSpacing: '2px' }}>
            NO RUNS YET
          </div>
          <div style={{ fontSize: '0.8rem', color: '#333' }}>
            Deploy a strategy from the Code Arena to see results here.
          </div>
          <button className="btn-primary" onClick={() => navigate('/')}>
            <Play size={12} fill="currentColor" /> GO TO CODE ARENA
          </button>
        </div>
      )}

      {/* ── Run cards ──────────────────────────────────────────────── */}
      {runs.map((run) => {
        const pos = run.pnl >= 0;
        const topBot = Object.entries(run.botActivity || {}).sort(([,a],[,b]) => b-a)[0];
        return (
          <div key={run.id} 
            onClick={(e) => {
              if (e.target.closest('button')) return;
              VidhiEngine.loadHistoricState(run);
              navigate('/simulation');
            }}
            style={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--border-glass)',
            display: 'grid', gridTemplateColumns: '1fr auto', gap: '0', overflow: 'hidden',
            cursor: 'pointer', transition: 'border-color 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text-bright)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-glass)'}
          >

            {/* Left content */}
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Top row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <CheckCircle2 size={14} color="#10b981" />
                <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '0.75rem',
                  color: 'var(--text-dim)', letterSpacing: '1px' }}>{run.id.slice(0, 22)}</span>
                <span style={{ fontSize: '0.7rem', color: '#444' }}>{formatTime(run.timestamp)}</span>
                {/* Mode badge */}
                <span style={{ fontSize: '0.6rem', padding: '1px 6px',
                  backgroundColor: run.mode === 'backend' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.08)',
                  border: `1px solid ${run.mode === 'backend' ? '#10b98140' : '#f59e0b40'}`,
                  color: run.mode === 'backend' ? '#10b981' : '#f59e0b',
                  fontFamily: "'Roboto Mono', monospace" }}>
                  {run.mode === 'backend' ? 'BACKEND' : 'LOCAL'}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: '#555',
                  fontFamily: "'Roboto Mono', monospace" }}>{run.ticks.toLocaleString()} ticks</span>
              </div>

              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
                {[
                  { label: 'PnL%',   value: `${pos ? '+' : ''}${run.pnlPct.toFixed(4)}%`, color: pos ? '#10b981' : '#e11d48' },
                  { label: 'PnL $',  value: `${pos ? '+' : ''}$${run.pnl.toFixed(0)}`,    color: pos ? '#10b981' : '#e11d48' },
                  { label: 'p50',    value: `${run.p50.toFixed(0)} ns`,  color: 'var(--text-bright)' },
                  { label: 'p99',    value: `${run.p99.toFixed(0)} ns`,  color: run.p99 < 200 ? '#10b981' : '#f59e0b' },
                  { label: 'FILLS',  value: run.fills.toLocaleString(),  color: 'var(--text-bright)' },
                ].map(s => (
                  <div key={s.label}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)',
                      fontFamily: "'Roboto Mono', monospace", letterSpacing: '1px', marginBottom: '3px' }}>{s.label}</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: s.color,
                      fontFamily: "'Roboto Mono', monospace" }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Correctness score (backend runs only) */}
              {run.correctness !== null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '6px 10px', backgroundColor: 'rgba(0,0,0,0.3)',
                  border: `1px solid ${run.correctness >= 0.95 ? '#10b98130' : run.correctness >= 0.80 ? '#f59e0b30' : '#e11d4830'}` }}>
                  <ShieldCheck size={11} color={run.correctness >= 0.95 ? '#10b981' : run.correctness >= 0.80 ? '#f59e0b' : '#e11d48'} />
                  <span style={{ fontSize: '0.65rem', fontFamily: "'Roboto Mono', monospace",
                    color: run.correctness >= 0.95 ? '#10b981' : run.correctness >= 0.80 ? '#f59e0b' : '#e11d48' }}>
                    SHADOW LOB CORRECTNESS: {run.correctness.toFixed(4)}
                    {run.violations > 0 ? `  (${run.violations} violations)` : '  ✓ CLEAN'}
                  </span>
                </div>
              )}

              {/* Bot activity hint */}
              {Object.keys(run.botActivity || {}).length > 0 && (() => {
                const topBot = Object.entries(run.botActivity).sort(([,a],[,b]) => b-a)[0];
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px',
                    fontSize: '0.65rem', color: '#555', fontFamily: "'Roboto Mono', monospace" }}>
                    <Bot size={10} />
                    Most active bot: <span style={{ color: '#888' }}>
                      {topBot[0]} ({topBot[1]} fills)
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Right — sparkline + actions */}
            <div style={{ borderLeft: '1px solid var(--border-glass)', padding: '16px',
              display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px' }}>
              <TinyChart history={run.history} color={pos ? '#10b981' : '#e11d48'} />
              <div style={{ display: 'flex', gap: '8px' }}>
                {run.code && (
                  <button title="Download submitted code"
                    onClick={() => {
                      const blob = new Blob([run.code], { type: 'text/plain' });
                      const url  = URL.createObjectURL(blob);
                      const a    = document.createElement('a');
                      a.href = url; a.download = `${run.id}_trader.py`; a.click();
                    }}
                    style={{ background: 'transparent', border: '1px solid #222', padding: '6px 10px',
                      color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                      fontSize: '0.65rem', fontFamily: "'Roboto Mono', monospace" }}>
                    <FileCode2 size={10} /> CODE
                  </button>
                )}
                <button title="Download execution logs"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href = url; a.download = `${run.id}_execution.json`; a.click();
                  }}
                  style={{ background: 'transparent', border: '1px solid #222', padding: '6px 10px',
                    color: '#a855f7', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                    fontSize: '0.65rem', fontFamily: "'Roboto Mono', monospace" }}>
                  <Download size={10} /> .LOG
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* ── Final submission note ───────────────────────────────────── */}
      <div style={{ backgroundColor: '#050505', border: '1px solid #1a1a1a', padding: '14px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: '0.7rem', fontFamily: "'Roboto Mono', monospace" }}>
        <span style={{ color: '#555' }}>
          ⚠ Browser phase: 100k public ticks. Final submission: 1M hidden ticks on bare-metal EPYC.
        </span>
        <span style={{ color: '#a855f7' }}>
          Last submitted code auto-enters Final Crucible.
        </span>
      </div>
    </div>
  );
}
