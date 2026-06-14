// src/pages/ContestLobby.jsx
// Student view — browse contests, join one, see active round

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, Clock, Users, ChevronRight, Play, Lock, CheckCircle, Circle, Zap, LogOut, Download } from 'lucide-react';
import ContestStore from '../store/ContestStore';
import { getDataset } from '../utils/idb';

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg = {
    active: { color: '#10b981', bg: 'rgba(16,185,129,0.08)', label: '● LIVE' },
    draft: { color: '#555', bg: 'rgba(100,100,100,0.08)', label: '◌ DRAFT' },
    ended: { color: '#e11d48', bg: 'rgba(225,29,72,0.08)', label: '✕ ENDED' },
    upcoming: { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', label: '◷ UPCOMING' },
  };
  const s = cfg[status] || cfg.draft;
  return (
    <span style={{
      padding: '3px 8px', backgroundColor: s.bg, color: s.color,
      fontFamily: "'Roboto Mono', monospace", fontSize: '0.65rem', letterSpacing: '1px',
      border: `1px solid ${s.color}40`
    }}>
      {s.label}
    </span>
  );
}

// ─── Round timeline ───────────────────────────────────────────────────────────
function RoundTimeline({ rounds }) {
  return (
    <div style={{ display: 'flex', gap: '0', marginTop: '12px' }}>
      {rounds.map((r, i) => (
        <div key={r.id} style={{ flex: 1, position: 'relative' }}>
          {/* Connector line */}
          {i < rounds.length - 1 && (
            <div style={{
              position: 'absolute', top: 6, left: '50%', width: '100%',
              height: 1, backgroundColor: r.status === 'ended' ? '#10b981' : '#222', zIndex: 0
            }} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', position: 'relative', zIndex: 1 }}>
            <div style={{
              width: 13, height: 13, borderRadius: '50%',
              backgroundColor: r.status === 'ended' ? '#10b981' : r.status === 'active' ? 'var(--brand-cyan)' : '#222',
              border: `2px solid ${r.status === 'ended' ? '#10b981' : r.status === 'active' ? 'var(--brand-cyan)' : '#333'}`,
              boxShadow: r.status === 'active' ? '0 0 8px var(--brand-cyan)' : 'none'
            }} />
            <div style={{
              fontSize: '0.55rem', color: r.status === 'ended' ? '#10b981' : r.status === 'active' ? 'var(--brand-cyan)' : '#444',
              fontFamily: "'Roboto Mono', monospace", textAlign: 'center', lineHeight: 1.3
            }}>
              R{i + 1}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Contest card ─────────────────────────────────────────────────────────────
function ContestCard({ contest, isJoined, onJoin }) {
  const [hovered, setHovered] = useState(false);
  const navigate = useNavigate();
  const rounds = contest.rounds || [];
  const activeRound = rounds.find(r => r.status === 'active');
  const timeLeft = contest.endsAt ? Math.max(0, new Date(contest.endsAt) - Date.now()) : 0;
  const daysLeft = Math.floor(timeLeft / (24 * 3600 * 1000));
  const hoursLeft = Math.floor((timeLeft % (24 * 3600 * 1000)) / 3600000);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        backgroundColor: '#080808',
        border: `1px solid ${hovered ? (isJoined ? '#a855f7' : '#333') : '#1a1a1a'}`,
        padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px',
        transition: 'border-color 0.2s, background-color 0.2s',
        backgroundColor: hovered ? '#0a0a0a' : '#080808',
        cursor: 'pointer',
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* Glow line if joined */}
      {isJoined && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: 'linear-gradient(90deg, transparent, #a855f7, transparent)'
        }} />
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <Trophy size={16} color="#f59e0b" />
            <span style={{
              color: 'var(--text-bright)', fontFamily: "'Roboto Mono', monospace",
              fontSize: '0.95rem', fontWeight: 700
            }}>{contest.name}</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0, lineHeight: 1.5 }}>
            {contest.description}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          <StatusBadge status={contest.status} />
          {isJoined && (
            <span style={{
              color: '#a855f7', fontSize: '0.6rem',
              fontFamily: "'Roboto Mono', monospace", letterSpacing: '1px'
            }}>✓ JOINED</span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', backgroundColor: '#111' }}>
        {[
          { label: 'ROUNDS', value: rounds.length },
          { label: 'PARTICIPANTS', value: (contest.participants || []).length },
          { label: 'TIME LEFT', value: daysLeft > 0 ? `${daysLeft}d ${hoursLeft}h` : `${hoursLeft}h` },
          { label: 'ACTIVE ROUND', value: activeRound ? activeRound.name.split('—')[0].trim() : 'None' },
        ].map(s => (
          <div key={s.label} style={{ backgroundColor: '#050505', padding: '10px 12px' }}>
            <div style={{
              color: '#444', fontSize: '0.55rem',
              fontFamily: "'Roboto Mono', monospace", letterSpacing: '1px', marginBottom: '3px'
            }}>{s.label}</div>
            <div style={{
              color: 'var(--text-bright)', fontFamily: "'Roboto Mono', monospace",
              fontSize: '0.8rem', fontWeight: 600
            }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Round timeline */}
      <RoundTimeline rounds={rounds} />

      {/* Active round info */}
      {activeRound && (
        <div style={{ backgroundColor: '#050505', border: '1px solid #1a1a1a', padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{
                color: '#a855f7', fontFamily: "'Roboto Mono', monospace",
                fontSize: '0.65rem', letterSpacing: '1px', marginBottom: '3px'
              }}>CURRENT ROUND</div>
              <div style={{
                color: 'var(--text-bright)', fontSize: '0.85rem',
                fontFamily: "'Roboto Mono', monospace"
              }}>{activeRound.name}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                color: '#555', fontSize: '0.6rem',
                fontFamily: "'Roboto Mono', monospace", marginBottom: '3px'
              }}>ACTIVE BOTS</div>
              <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                {(activeRound.activeBots || []).map(b => (
                  <span key={b} style={{
                    padding: '1px 5px', border: '1px solid #222',
                    color: '#666', fontSize: '0.6rem', fontFamily: "'Roboto Mono', monospace"
                  }}>{b}</span>
                ))}
              </div>
            </div>
          </div>
          {activeRound.testDataKey && (
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #111', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#555', fontSize: '0.65rem', fontFamily: "'Roboto Mono', monospace" }}>{activeRound.testDataName} (99.99k ticks)</span>
              <button
                onClick={async () => {
                  try {
                    const csvData = await getDataset(activeRound.testDataKey);
                    if (!csvData) {
                      alert('Dataset not found locally. GM must upload it first.');
                      return;
                    }
                    const blob = new Blob([csvData], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = activeRound.testDataName;
                    a.click();
                  } catch (err) {
                    console.error('Failed to download dataset:', err);
                  }
                }}
                style={{
                  background: 'transparent', border: '1px solid #222', padding: '6px 12px',
                  color: '#10b981', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  fontSize: '0.65rem', fontFamily: "'Roboto Mono', monospace", transition: 'all 0.15s'
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.background = 'rgba(16,185,129,0.05)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#222'; e.currentTarget.style.background = 'transparent'; }}
              >
                <Download size={12} /> DOWNLOAD DATASET
              </button>
            </div>
          )}
        </div>
      )}

      {/* CTA */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {isJoined ? (
          <button onClick={() => navigate('/')} className="btn-primary" style={{ flex: 1 }}>
            <Play size={12} fill="currentColor" /> OPEN CODE ARENA
          </button>
        ) : (
          <button onClick={() => onJoin(contest.id)}
            disabled={contest.status !== 'active'}
            style={{
              flex: 1, padding: '10px', backgroundColor: 'transparent',
              border: `1px solid ${contest.status !== 'active' ? 'var(--border-glass)' : 'var(--text-bright)'}`,
              color: contest.status !== 'active' ? 'var(--text-dim)' : 'var(--text-bright)',
              cursor: contest.status !== 'active' ? 'not-allowed' : 'pointer',
              fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: '0.85rem', letterSpacing: '0.5px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              transition: 'all 0.15s', borderRadius: '4px'
            }}
            onMouseEnter={e => contest.status === 'active' && (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)')}
            onMouseLeave={e => contest.status === 'active' && (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            {contest.status === 'ended' ? <Lock size={12} /> : contest.status === 'upcoming' ? <Clock size={12} /> : <ChevronRight size={12} />}
            {contest.status === 'ended' ? 'CONTEST ENDED' : contest.status === 'upcoming' ? 'STARTS SOON' : 'JOIN CONTEST'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Lobby ───────────────────────────────────────────────────────────────
export default function ContestLobby() {
  const navigate = useNavigate();
  const [storeState, setStoreState] = useState(ContestStore.state);

  useEffect(() => {
    return ContestStore.subscribe(s => setStoreState({ ...s }));
  }, []);

  const handleJoin = (contestId) => {
    ContestStore.joinContest(contestId);
    navigate('/');
  };

  const handleLeave = () => {
    ContestStore.leaveContest();
  };

  const handleExit = () => {
    ContestStore.setRole(null);
    navigate('/select-role');
  };

  const activeContest = ContestStore.getActiveContest();
  const contests = storeState.contests.filter(c => c.status !== 'draft');

  return (
    <div style={{
      width: '100vw', height: '100vh', backgroundColor: '#000',
      overflowY: 'auto', padding: '32px', boxSizing: 'border-box'
    }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Zap size={20} color="#a855f7" />
          <div>
            <div style={{
              color: 'var(--text-bright)', fontFamily: "'Roboto Mono', monospace",
              fontSize: '0.9rem', letterSpacing: '3px'
            }}>CONTEST LOBBY</div>
            <div style={{
              color: '#555', fontFamily: "'Roboto Mono', monospace",
              fontSize: '0.65rem', marginTop: '2px'
            }}>
              Welcome, {storeState.studentName}
              {storeState.studentTeam && ` · ${storeState.studentTeam}`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {activeContest && (
            <button onClick={() => navigate('/')} style={{
              padding: '8px 16px', backgroundColor: 'transparent',
              border: '1px solid #a855f7', color: '#a855f7', cursor: 'pointer',
              fontFamily: "'Roboto Mono', monospace", fontSize: '0.7rem',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <Play size={11} fill="currentColor" /> CODE ARENA
            </button>
          )}
          <button onClick={handleExit} style={{
            padding: '8px 16px', backgroundColor: 'transparent',
            border: '1px solid #222', color: '#555', cursor: 'pointer',
            fontFamily: "'Roboto Mono', monospace", fontSize: '0.7rem',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <LogOut size={11} /> EXIT
          </button>
        </div>
      </div>

      {/* Active contest banner */}
      {activeContest && (
        <div style={{
          backgroundColor: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)',
          padding: '14px 20px', marginBottom: '24px', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', backgroundColor: '#a855f7',
              boxShadow: '0 0 8px #a855f7', animation: 'pulse 1s infinite alternate'
            }} />
            <span style={{ color: '#a855f7', fontFamily: "'Roboto Mono', monospace", fontSize: '0.8rem' }}>
              ACTIVE: {activeContest.name}
            </span>
          </div>
          <button onClick={handleLeave} style={{
            background: 'transparent', border: '1px solid #333', color: '#555',
            padding: '4px 10px', cursor: 'pointer', fontFamily: "'Roboto Mono', monospace", fontSize: '0.65rem',
          }}>LEAVE</button>
        </div>
      )}

      {/* Contest list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: 800, margin: '0 auto' }}>
        <div style={{
          color: '#444', fontFamily: "'Roboto Mono', monospace",
          fontSize: '0.65rem', letterSpacing: '2px', marginBottom: '4px'
        }}>
          AVAILABLE CONTESTS ({contests.length})
        </div>
        {contests.length === 0 ? (
          <div style={{
            textAlign: 'center', color: '#333', padding: '60px 0',
            fontFamily: "'Roboto Mono', monospace", fontSize: '0.8rem'
          }}>
            No active contests. Check back later.
          </div>
        ) : (
          contests.map(c => (
            <ContestCard
              key={c.id}
              contest={c}
              isJoined={storeState.activeContestId === c.id}
              onJoin={handleJoin}
            />
          ))
        )}
      </div>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() { if (this.state.hasError) return <div style={{ color: 'red', padding: '50px' }}><h1>Crash!</h1><pre>{this.state.error.stack}</pre></div>; return this.props.children; }
}
