import React, { useState, useEffect, useRef } from 'react';
import { History, Download, Play, CheckCircle2, XCircle, Bot, ShieldCheck, FileCode2 } from 'lucide-react';
import VidhiEngine from '../engine/VidhiEngine';
import { useNavigate } from 'react-router-dom';
import { downloadRunCode, downloadRunLog } from '../api/client';
import ContestStore from '../store/ContestStore';

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
  const [expandedRunId, setExpandedRunId] = useState(null);
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px', gap: '16px', backgroundColor: '#000', overflowY: 'auto' }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="cc-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <History size={18} color="var(--text-secondary)" />
          <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>
            SUBMISSION HISTORY
          </span>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {/* Credit counter */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} style={{ 
                width: 10, height: 10,
                backgroundColor: i < credits ? '#a855f7' : '#1a1a1a',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '2px',
                boxShadow: i < credits ? '0 0 4px rgba(168,85,247,0.5)' : 'none',
                transition: 'all 0.3s' 
              }} />
            ))}
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem',
              fontFamily: "'Roboto Mono', monospace", marginLeft: '6px' }}>
              {credits}/5 DAILY RUNS
            </span>
          </div>
          <button onClick={() => navigate('/')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '8px', backgroundColor: 'var(--accent-blue)', color: '#fff', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            <Play size={14} fill="currentColor" /> NEW RUN
          </button>
        </div>
      </div>

      {/* ── Empty state ────────────────────────────────────────────── */}
      {runs.length === 0 && (
        <div className="cc-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: '16px', color: 'var(--text-secondary)', padding: '40px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
          <History size={48} color="var(--text-secondary)" strokeWidth={1} />
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
            NO RUNS YET
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
            Deploy a strategy from the Code Arena to see results here.
          </div>
          <button onClick={() => navigate('/')}
            style={{ padding: '10px 20px', borderRadius: '8px', backgroundColor: 'var(--accent-blue)', color: '#fff', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            <Play size={14} fill="currentColor" style={{ marginRight: '6px' }} /> GO TO CODE ARENA
          </button>
        </div>
      )}

      {/* ── Run cards ──────────────────────────────────────────────── */}
      {runs.map((run) => {
        const isSuccessful = run.status === 'complete';
        const pos = (run.pnl || 0) >= 0;
        return (
          <div key={run.id} className="cc-card"
            onClick={(e) => {
              if (e.target.closest('button')) return;
              setExpandedRunId(expandedRunId === run.id ? null : run.id);
            }}
            style={{ backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)',
            display: 'grid', gridTemplateColumns: '1fr auto', gap: '0', overflow: 'hidden', borderRadius: '12px',
            cursor: 'pointer', transition: 'all 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-blue)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'}
          >

            {/* Left content */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Top row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                {isSuccessful ? (
                  <CheckCircle2 size={18} color="#4ade80" />
                ) : (
                  <XCircle size={18} color="#f87171" />
                )}
                <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '0.8rem',
                  color: 'var(--text-secondary)' }}>{run.id.slice(0, 22)}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{formatTime(run.timestamp)}</span>
                {/* Mode badge */}
                <span style={{ fontSize: '0.65rem', padding: '4px 10px', borderRadius: '4px',
                  backgroundColor: run.mode === 'backend' ? 'rgba(50,107,255,0.1)' : 'rgba(245,158,11,0.08)',
                  border: `1px solid ${run.mode === 'backend' ? 'rgba(50,107,255,0.3)' : 'rgba(245,158,11,0.3)'}`,
                  color: run.mode === 'backend' ? 'var(--accent-blue)' : 'var(--accent-yellow)',
                  fontFamily: "'Roboto Mono', monospace" }}>
                  {run.mode === 'backend' ? 'BACKEND' : 'LOCAL'}
                </span>
                <span style={{ fontSize: '0.65rem', padding: '4px 10px', borderRadius: '4px',
                  backgroundColor: isSuccessful ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                  border: `1px solid ${isSuccessful ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
                  color: isSuccessful ? '#4ade80' : '#f87171',
                  fontFamily: "'Roboto Mono', monospace" }}>
                  {String(run.status || 'unknown').toUpperCase()}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-tertiary)',
                  fontFamily: "'Roboto Mono', monospace" }}>{(run.ticks || 0).toLocaleString()} ticks</span>
              </div>

              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '20px' }}>
                {[
                  { label: 'PnL%',   value: `${pos ? '+' : ''}${(run.pnlPct || 0).toFixed(4)}%`, color: pos ? '#4ade80' : '#f87171' },
                  { label: 'PnL $',  value: `${pos ? '+' : ''}$${(run.pnl || 0).toFixed(0)}`,    color: pos ? '#4ade80' : '#f87171' },
                  { label: 'p50',    value: `${(run.p50 || 0).toFixed(0)} ns`,  color: '#fff' },
                  { label: 'p99',    value: `${(run.p99 || 0).toFixed(0)} ns`,  color: (run.p99 || 0) < 200 ? '#4ade80' : '#fbbf24' },
                  { label: 'FILLS',  value: (run.fills || 0).toLocaleString(),  color: '#fff' },
                ].map(s => (
                  <div key={s.label}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)',
                      fontFamily: "'Roboto Mono', monospace", marginBottom: '4px' }}>{s.label}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: s.color,
                      fontFamily: "'Roboto Mono', monospace" }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Correctness score (backend runs only) */}
              {run.correctness !== null && run.correctness !== undefined && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 14px', backgroundColor: 'rgba(0,0,0,0.2)',
                  border: `1px solid ${run.correctness >= 0.95 ? 'rgba(74,222,128,0.2)' : run.correctness >= 0.80 ? 'rgba(245,158,11,0.2)' : 'rgba(248,113,113,0.2)'}`, borderRadius: '8px' }}>
                  <ShieldCheck size={14} color={run.correctness >= 0.95 ? '#4ade80' : run.correctness >= 0.80 ? '#fbbf24' : '#f87171'} />
                  <span style={{ fontSize: '0.75rem', fontFamily: "'Roboto Mono', monospace",
                    color: run.correctness >= 0.95 ? '#4ade80' : run.correctness >= 0.80 ? '#fbbf24' : '#f87171' }}>
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
                    fontSize: '0.75rem', color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
                    <Bot size={14} />
                    Most active bot: <span style={{ color: 'var(--text-secondary)' }}>
                      {topBot[0]} ({topBot[1]} fills)
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Right — sparkline + actions */}
            <div style={{ borderLeft: '1px solid rgba(255,255,255,0.05)', padding: '20px',
              display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px' }}>
              <TinyChart history={run.history || []} color={pos ? '#4ade80' : '#f87171'} />
              <div style={{ display: 'flex', gap: '10px' }}>
                {run.code && (
                  <button title="Download submitted code"
                    onClick={() => downloadRunCode(run.id).catch(e => alert(e.message))}
                    style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 14px', borderRadius: '6px',
                      color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                      fontSize: '0.75rem', fontFamily: "'Roboto Mono', monospace" }}>
                    <FileCode2 size={14} /> CODE
                  </button>
                )}
                <button title="Download execution logs"
                  onClick={() => downloadRunLog(run.id).catch(e => alert(e.message))}
                  style={{ background: 'transparent', border: '1px solid rgba(168,85,247,0.3)', padding: '8px 14px', borderRadius: '6px',
                    color: '#a855f7', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                    fontSize: '0.75rem', fontFamily: "'Roboto Mono', monospace" }}>
                  <Download size={14} /> .LOG
                </button>
              </div>
            </div>
            
            {/* Expanded View */}
            {expandedRunId === run.id && (
              <div style={{
                gridColumn: '1 / -1', borderTop: '1px solid rgba(255,255,255,0.05)',
                backgroundColor: '#050505', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px'
              }}>
                {/* Code panel */}
                <div style={{ padding: '20px', backgroundColor: '#0D0F12' }}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontFamily: "'Roboto Mono', monospace", marginBottom: '12px' }}>SUBMITTED ALGORITHM</div>
                  <pre style={{ margin: 0, padding: '16px', backgroundColor: '#050505', color: '#4ade80', fontSize: '0.8rem', fontFamily: "'Roboto Mono', monospace", borderRadius: '8px', overflowX: 'auto', border: '1px solid rgba(255,255,255,0.05)', whiteSpace: 'pre-wrap', maxHeight: '250px' }}>
                    {run.code || '# No code available'}
                  </pre>
                </div>
                {/* Stats & Graph panel */}
                <div style={{ padding: '20px', backgroundColor: '#0D0F12', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontFamily: "'Roboto Mono', monospace" }}>PERFORMANCE GRAPH (PnL)</div>
                  <div style={{ flex: 1, backgroundColor: '#050505', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '150px' }}>
                    {(run.history && run.history.length > 0) ? (
                      <div style={{ width: '100%', height: '120px' }}>
                        {/* Simple SVG line chart */}
                        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                          {(() => {
                            const data = run.history.map(d => d.pnl ?? d);
                            const min = Math.min(...data);
                            const max = Math.max(...data);
                            const range = max - min || 1;
                            const points = data.map((val, i) => {
                              const x = (i / (data.length - 1)) * 100;
                              const y = 100 - ((val - min) / range) * 100;
                              return `${x},${y}`;
                            }).join(' ');
                            return (
                              <>
                                <path d={`M${points}`} fill="none" stroke={pos ? '#4ade80' : '#f87171'} strokeWidth="2" />
                                <path d={`M0,100 L${points} L100,100 Z`} fill={`url(#gradient-${run.id})`} opacity="0.2" />
                                <defs>
                                  <linearGradient id={`gradient-${run.id}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={pos ? '#4ade80' : '#f87171'} />
                                    <stop offset="100%" stopColor="transparent" />
                                  </linearGradient>
                                </defs>
                              </>
                            );
                          })()}
                        </svg>
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-tertiary)' }}>No graph available</div>
                    )}
                  </div>
                  <button onClick={() => {
                      VidhiEngine.loadHistoricState(run);
                      navigate('/simulation');
                    }}
                    style={{ background: 'var(--accent-blue)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontFamily: "'Roboto Mono', monospace", fontSize: '0.85rem', fontWeight: 600 }}>
                    LOAD IN BACKTEST DASHBOARD
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Final submission note ───────────────────────────────────── */}
      <div className="cc-card" style={{ backgroundColor: '#050505', border: '1px solid rgba(255,255,255,0.05)', padding: '16px 20px', borderRadius: '12px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: '0.75rem', fontFamily: "'Roboto Mono', monospace" }}>
        <span style={{ color: 'var(--text-tertiary)' }}>
          ⚠ Browser phase: 100k public ticks. Final submission: 1M hidden ticks on bare-metal EPYC.
        </span>
        <span style={{ color: '#a855f7' }}>
          Last submitted code auto-enters Final Crucible.
        </span>
      </div>
    </div>
  );
}
