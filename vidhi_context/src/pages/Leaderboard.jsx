// src/pages/Leaderboard.jsx
// Student vs Student ONLY — bots never appear here.
// Bots exist privately in each student's simulation session.
// This shows: your PnL% vs other students' submitted PnL% for this contest.

import React, { useState, useEffect, useRef } from 'react';
import { Trophy, TrendingUp, TrendingDown, Zap, Award, Users, Info } from 'lucide-react';
import ContestStore from '../store/ContestStore';
import VidhiEngine from '../engine/VidhiEngine';

// ─── Canvas sparkline ─────────────────────────────────────────────────────────
function MiniChart({ vals = [], color = '#10b981', w = 100, h = 28 }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || vals.length < 2) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
    const tx = i => (i / (vals.length - 1)) * w;
    const ty = v => h - ((v - min) / range) * (h - 2) - 1;
    ctx.beginPath();
    ctx.moveTo(tx(0), ty(vals[0]));
    for (let i = 1; i < vals.length; i++) ctx.lineTo(tx(i), ty(vals[i]));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [vals, color, w, h]);
  return <canvas ref={ref} width={w} height={h} style={{ width: w, height: h, display: 'block' }} />;
}

// ─── Rank badge ───────────────────────────────────────────────────────────────
function Rank({ n }) {
  const c = { 1: '#f59e0b', 2: '#94a3b8', 3: '#cd7c2e' };
  return (
    <div style={{ width: 26, height: 26, borderRadius: '50%', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Roboto Mono', monospace", fontSize: '0.72rem', fontWeight: 700,
      backgroundColor: c[n] ? c[n] + '20' : 'transparent',
      border: `1px solid ${c[n] || '#222'}`, color: c[n] || '#444' }}>
      {n}
    </div>
  );
}

// ─── Student row ──────────────────────────────────────────────────────────────
function StudentRow({ entry, isMe, liveState, pulse }) {
  const pnlPct = isMe ? (liveState?.pnlPct ?? entry.pnlPct) : entry.pnlPct;
  const p99    = isMe ? (liveState?.p99    ?? entry.p99)    : entry.p99;
  const p50    = isMe ? (liveState?.p50    ?? entry.p50)    : entry.p50;
  const pos    = pnlPct >= 0;
  // Sparkline from round history
  const sparkVals = (entry.rounds || []).length > 0
    ? entry.rounds.map(r => r ?? 0)
    : [0, pnlPct];

  return (
    <tr style={{
      borderBottom: '1px solid rgba(255,255,255,0.03)',
      backgroundColor: isMe ? 'rgba(168,85,247,0.05)' : 'transparent',
      transition: 'background-color 0.3s',
    }}>
      <td style={{ padding: '12px 16px' }}><Rank n={entry.rank} /></td>
      <td style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isMe && (
            <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#a855f7',
              boxShadow: pulse ? '0 0 8px #a855f7' : 'none', transition: 'box-shadow 0.3s' }} />
          )}
          <div>
            <div style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '0.8rem',
              color: isMe ? '#a855f7' : 'var(--text-bright)', fontWeight: isMe ? 700 : 400 }}>
              {entry.name}
              {isMe && <span style={{ marginLeft: '8px', fontSize: '0.6rem', color: '#a855f7',
                border: '1px solid #a855f760', padding: '1px 5px' }}>YOU</span>}
            </div>
            {entry.team && (
              <div style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '0.65rem',
                color: '#444', marginTop: '2px' }}>{entry.team}</div>
            )}
          </div>
        </div>
      </td>
      <td style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {pos ? <TrendingUp size={12} color="#10b981" /> : <TrendingDown size={12} color="#e11d48" />}
          <span style={{ fontFamily: "'Roboto Mono', monospace", fontWeight: 700, fontSize: '0.9rem',
            color: pos ? '#10b981' : '#e11d48' }}>
            {pos ? '+' : ''}{pnlPct.toFixed(4)}%
          </span>
        </div>
      </td>
      <td style={{ padding: '12px 16px' }}>
        <MiniChart vals={sparkVals} color={pos ? '#10b981' : '#e11d48'} />
      </td>
      <td style={{ padding: '12px 16px', fontFamily: "'Roboto Mono', monospace",
        fontSize: '0.75rem', color: p50 ? 'var(--text-bright)' : '#666' }}>
        {p50 ? `${p50} ns` : '—'}
      </td>
      <td style={{ padding: '12px 16px', fontFamily: "'Roboto Mono', monospace",
        fontSize: '0.75rem', color: p99 && p99 < 200 ? '#10b981' : p99 < 1000 ? '#f59e0b' : '#666' }}>
        {p99 ? `${p99} ns` : '—'}
      </td>
      <td style={{ padding: '12px 16px', fontFamily: "'Roboto Mono', monospace",
        fontSize: '0.75rem', color: '#555' }}>
        {entry.fills?.toLocaleString() || '—'}
      </td>
      {/* Per-round PnL% columns */}
      {[0, 1, 2].map(ri => (
        <td key={ri} style={{ padding: '12px 16px', fontFamily: "'Roboto Mono', monospace",
          fontSize: '0.72rem',
          color: (entry.rounds?.[ri] ?? null) !== null
            ? entry.rounds[ri] >= 0 ? '#10b981' : '#e11d48'
            : '#333' }}>
          {(entry.rounds?.[ri] ?? null) !== null
            ? `${entry.rounds[ri] >= 0 ? '+' : ''}${entry.rounds[ri].toFixed(2)}%`
            : '—'}
        </td>
      ))}
    </tr>
  );
}

export default function Leaderboard() {
  const [storeState,  setStoreState]  = useState(ContestStore.state);
  const [liveState,   setLiveState]   = useState(null);
  const [pulse,       setPulse]       = useState(false);
  const [backendRows, setBackendRows] = useState([]);  // from /api/leaderboard
  const [backendOnline, setBackendOnline] = useState(false);

  useEffect(() => {
    const unsubStore  = ContestStore.subscribe(s => setStoreState({ ...s }));
    const unsubEngine = VidhiEngine.subscribe(data => {
      setLiveState(data);
      setPulse(true);
      setTimeout(() => setPulse(false), 400);
    });
    const unsubStatus = VidhiEngine.onStatus(() => {
      setBackendOnline(VidhiEngine.getMode() === 'backend');
    });

    // Poll real leaderboard from backend every 10s
    let interval = null;
    async function fetchLB() {
      const activeRoundId = ContestStore.getActiveRoundId();
      const url = activeRoundId ? `/api/leaderboard?round_id=${activeRoundId}` : '/api/leaderboard';
      fetch(url)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (!data) return;
          setBackendOnline(true);
          setBackendRows(data.slice(0, 50).map((r, i) => ({
            id:     r.user_id,
            name:   r.display_name || r.user_id || 'Anonymous',
            team:   r.team_name || '',
            pnlPct: r.pnl_pct   ?? 0,
            p99:    r.p99_ns    ?? 0,
            fills:  r.total_fills ?? 0,
            rounds: [],
            rank:   r.rank || (i + 1),
          })));
        })
        .catch(() => setBackendOnline(false));
    }

    fetchLB();
    interval = setInterval(fetchLB, 10_000);

    return () => {
      unsubStore();
      unsubEngine();
      unsubStatus();
      if (interval) clearInterval(interval);
    };
  }, []);

  const contestId   = storeState.activeContestId;
  const contest     = contestId ? ContestStore.getContest(contestId) : null;
  const localEntries = contest  ? ContestStore.getLeaderboard(contestId) : [];

  // Merge: backend rows take priority, then local contest entries
  const entries = backendRows.length > 0 ? backendRows : localEntries;

  const activeRound = contest?.rounds?.find(r => r.status === 'active');

  // My entry
  const myId = storeState.studentId || 'me';
  const myEntry = entries.find(e => e.id === myId) || localEntries.find(e => e.id === myId);
  const myRank  = myEntry?.rank ?? '—';
  const myPnl   = liveState?.pnlPct ?? myEntry?.pnlPct ?? 0;
  const myP99   = liveState?.p99    ?? myEntry?.p99    ?? 0;

  const noContest = !contestId || !contest;

  return (
    <div style={{ padding: '1.5rem', height: '100%', overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Trophy size={18} color="#f59e0b" />
          <span style={{ color: 'var(--text-bright)', fontFamily: "'Roboto Mono', monospace",
            fontSize: '0.85rem', letterSpacing: '2px' }}>STUDENT LEADERBOARD</span>
        </div>
        <div style={{ display: 'flex', gap: '20px', fontFamily: "'Roboto Mono', monospace", fontSize: '0.7rem' }}>
          <span style={{ color: '#555' }}>
            {contest ? contest.name : 'No active contest'}
          </span>
          {activeRound && (
            <span style={{ color: '#a855f7' }}>
              ● {activeRound.name.split('—')[0].trim()}
            </span>
          )}
        </div>
      </div>

      {/* ── Bots note ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px',
        backgroundColor: '#050505', border: '1px solid #1a1a1a', fontSize: '0.7rem',
        fontFamily: "'Roboto Mono', monospace", color: '#555' }}>
        <Info size={12} />
        Bots run privately inside each student's simulation — they are NOT on this board. This is student vs student.
      </div>

      {/* No contest state */}
      {noContest && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: '12px', color: '#333', padding: '80px 0' }}>
          <Users size={36} strokeWidth={1} />
          <div style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '0.8rem', letterSpacing: '2px' }}>
            JOIN A CONTEST FIRST
          </div>
          <div style={{ fontSize: '0.75rem', color: '#1a1a1a' }}>
            Browse contests in the Lobby.
          </div>
        </div>
      )}

      {/* ── Stats cards ────────────────────────────────────────────── */}
      {!noContest && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', backgroundColor: '#111' }}>
            {[
              { label: 'YOUR RANK',    value: myEntry ? `#${myRank}` : '—', color: '#f59e0b' },
              { label: 'YOUR PnL%',   value: myPnl ? `${myPnl >= 0 ? '+' : ''}${myPnl.toFixed(4)}%` : '—', color: myPnl >= 0 ? '#10b981' : '#e11d48' },
              { label: 'p99 LATENCY', value: myP99 ? `${myP99.toFixed(0)} ns` : '—', color: myP99 < 200 ? '#10b981' : '#f59e0b' },
              { label: 'COMPETITORS', value: entries.length, color: 'var(--text-bright)' },
            ].map(s => (
              <div key={s.label} style={{ backgroundColor: 'var(--panel-bg)', padding: '14px',
                display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <div style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '0.6rem',
                  color: 'var(--text-dim)', letterSpacing: '1.5px' }}>{s.label}</div>
                <div style={{ fontFamily: "'Roboto Mono', monospace", fontSize: '1.2rem',
                  fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* ── Main table ─────────────────────────────────────────── */}
          <div style={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--border-glass)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderBottom: '1px solid var(--border-glass)' }}>
                  {['RANK', 'STUDENT', 'TOTAL PnL%', 'CURVE', 'p50', 'p99', 'FILLS', 'R1', 'R2', 'R3'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left',
                      fontFamily: "'Roboto Mono', monospace", fontSize: '0.6rem',
                      letterSpacing: '1.5px', color: 'var(--text-dim)', fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <StudentRow
                    key={e.id}
                    entry={e}
                    isMe={e.id === myId}
                    liveState={liveState}
                    pulse={pulse && e.id === myId}
                  />
                ))}
                {entries.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center',
                    color: '#333', fontFamily: "'Roboto Mono', monospace", fontSize: '0.8rem' }}>
                    No submissions yet. Run your strategy and submit!
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Scoring footer ─────────────────────────────────────── */}
          <div style={{ padding: '12px 16px', backgroundColor: '#050505', border: '1px solid #111',
            display: 'flex', gap: '24px', flexWrap: 'wrap',
            fontFamily: "'Roboto Mono', monospace", fontSize: '0.65rem', color: '#444' }}>
            <span>RANK BY: Total PnL%</span>
            <span>TIEBREAKER: p99 latency</span>
            <span>POSITION LIMIT: {activeRound?.positionLimit ?? 1000}</span>
            <span>BOTS: Private to each session ({activeRound?.activeBots?.join(', ') ?? 'N/A'})</span>
          </div>
        </>
      )}
    </div>
  );
}
