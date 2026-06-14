// src/pages/ContestCreator.jsx
// Contest Creator Dashboard — full IMC Prosperity-style contest builder
// Tabs: My Contests | Create New | Monitor Live

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Settings, Eye, Play, Pause, Trash2, ChevronDown, ChevronUp,
  Bot, Zap, Trophy, Users, BarChart3, Clock, CheckCircle, AlertTriangle,
  TrendingUp, TrendingDown, LogOut, Save, ArrowRight, Upload } from 'lucide-react';
import ContestStore from '../store/ContestStore';
import { uploadRoundDataset, triggerFinalEvaluation } from '../api/client';
import VidhiEngine from '../engine/VidhiEngine';

// ─── Style helpers ────────────────────────────────────────────────────────────
const mono = { fontFamily: "'Roboto Mono', monospace" };
const labelStyle = { ...mono, fontSize: '0.6rem', color: '#555', letterSpacing: '1.5px', marginBottom: '5px' };
const inputStyle = {
  width: '100%', padding: '9px 12px', backgroundColor: '#050505',
  border: '1px solid #1a1a1a', color: 'var(--text-bright)', outline: 'none',
  ...mono, fontSize: '0.8rem', boxSizing: 'border-box', transition: 'border-color 0.15s',
};

// ─── Bot config ───────────────────────────────────────────────────────────────
const BOT_OPTS = [
  { id: 'MM',     name: 'Market Maker',  color: '#00d4ff', desc: 'Quotes bid/ask, inventory-skewed' },
  { id: 'MOM',    name: 'Momentum',      color: '#a855f7', desc: 'EMA crossover trend follower' },
  { id: 'MR',     name: 'Mean Reversion',color: '#f59e0b', desc: 'Fades price vs fair value' },
  { id: 'NOISE',  name: 'Noise Trader',  color: '#6b7280', desc: 'Random limit order spray' },
  { id: 'SNIPER', name: 'Sniper / Arb',  color: '#e11d48', desc: 'Instant fair-value arbitrage' },
];

// ─── Round builder card ───────────────────────────────────────────────────────
function RoundBuilder({ round, roundIndex, availableBots, onChange, onDelete }) {
  const [expanded, setExpanded] = useState(roundIndex === 0);

  const toggleBot = (botId) => {
    const current = round.activeBots || [];
    const next = current.includes(botId)
      ? current.filter(b => b !== botId)
      : [...current, botId];
    onChange({ ...round, activeBots: next });
  };

  return (
    <div style={{ border: '1px solid #1a1a1a', backgroundColor: '#050505', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px',
        cursor: 'pointer', borderBottom: expanded ? '1px solid #111' : 'none' }}
        onClick={() => setExpanded(e => !e)}>
        <div style={{ width: 24, height: 24, border: '1px solid #333', borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          ...mono, fontSize: '0.7rem', color: '#a855f7' }}>
          {roundIndex + 1}
        </div>
        <input
          value={round.name}
          onChange={e => { e.stopPropagation(); onChange({ ...round, name: e.target.value }); }}
          onClick={e => e.stopPropagation()}
          style={{ ...inputStyle, width: 'auto', flex: 1, border: 'none', backgroundColor: 'transparent',
            padding: '0', fontSize: '0.85rem', fontWeight: 700 }}
          placeholder={`Round ${roundIndex + 1} — Name`}
        />
        <div style={{ display: 'flex', gap: '6px' }}>
          {(round.activeBots || []).map(b => {
            const bot = availableBots.find(o => o.id === b);
            return (
              <div key={b} style={{ width: 8, height: 8, borderRadius: '50%',
                backgroundColor: bot?.color || '#333' }} />
            );
          })}
        </div>
        <button onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#333', padding: '4px', transition: 'color 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#e11d48'}
          onMouseLeave={e => e.currentTarget.style.color = '#333'}>
          <Trash2 size={14} />
        </button>
        {expanded ? <ChevronUp size={14} color="#444" /> : <ChevronDown size={14} color="#444" />}
      </div>

      {/* Content */}
      {expanded && (
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Description */}
          <div>
            <div style={labelStyle}>DESCRIPTION</div>
            <textarea
              value={round.description || ''}
              onChange={e => onChange({ ...round, description: e.target.value })}
              style={{ ...inputStyle, height: 60, resize: 'vertical', lineHeight: 1.5 }}
              placeholder="Describe this round's market conditions..."
            />
          </div>

          {/* Grid: tick count, position limit, capital, asset */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
            {[
              { label: 'TICK COUNT', field: 'tickCount', placeholder: '100000', type: 'number' },
              { label: 'POSITION LIMIT', field: 'positionLimit', placeholder: '1000', type: 'number' },
              { label: 'STARTING CAPITAL $', field: 'startingCapital', placeholder: '100000', type: 'number' },
              { label: 'ASSET NAME', field: 'assetName', placeholder: 'VIDHI-1', type: 'text' },
            ].map(f => (
              <div key={f.field}>
                <div style={labelStyle}>{f.label}</div>
                <input
                  type={f.type}
                  value={f.field === 'assetName' ? (round.asset?.name || '') : (round[f.field] || '')}
                  onChange={e => {
                    if (f.field === 'assetName') {
                      onChange({ ...round, asset: { ...(round.asset || {}), name: e.target.value } });
                    } else {
                      onChange({ ...round, [f.field]: f.type === 'number' ? parseInt(e.target.value) : e.target.value });
                    }
                  }}
                  style={inputStyle}
                  placeholder={f.placeholder}
                  onFocus={e => e.target.style.borderColor = '#a855f7'}
                  onBlur={e => e.target.style.borderColor = '#1a1a1a'}
                />
              </div>
            ))}
          </div>

          {/* Bot selector */}
          <div>
            <div style={labelStyle}>ACTIVE BOTS IN THIS ROUND</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {availableBots.map(bot => {
                const active = (round.activeBots || []).includes(bot.id);
                return (
                  <button key={bot.id} onClick={() => toggleBot(bot.id)} style={{
                    padding: '7px 12px', backgroundColor: active ? bot.color + '15' : 'transparent',
                    border: `1px solid ${active ? bot.color : '#222'}`,
                    color: active ? bot.color : '#444', cursor: 'pointer',
                    ...mono, fontSize: '0.7rem', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '6px',
                  }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%',
                      backgroundColor: active ? bot.color : '#333' }} />
                    {bot.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Aggressiveness */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <div style={labelStyle}>BOT AGGRESSIVENESS</div>
              <span style={{ ...mono, fontSize: '0.75rem', color: '#a855f7' }}>
                {Math.round((round.botAggressiveness || 0.5) * 100)}%
              </span>
            </div>
            <input
              type="range" min={0} max={100}
              value={Math.round((round.botAggressiveness || 0.5) * 100)}
              onChange={e => onChange({ ...round, botAggressiveness: parseInt(e.target.value) / 100 })}
              style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between',
              ...mono, fontSize: '0.55rem', color: '#333', marginTop: '3px' }}>
              <span>PASSIVE (Noise only)</span>
              <span>AGGRESSIVE (Sniper + MM tight)</span>
            </div>
          </div>

          {/* Time window */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <div style={labelStyle}>START DATE/TIME</div>
              <input type="datetime-local"
                value={round.startAt ? round.startAt.substring(0, 16) : ''}
                onChange={e => onChange({ ...round, startAt: e.target.value })}
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = '#a855f7'}
                onBlur={e => e.target.style.borderColor = '#1a1a1a'}
              />
            </div>
            <div>
              <div style={labelStyle}>END DATE/TIME</div>
              <input type="datetime-local"
                value={round.endAt ? round.endAt.substring(0, 16) : ''}
                onChange={e => onChange({ ...round, endAt: e.target.value })}
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = '#a855f7'}
                onBlur={e => e.target.style.borderColor = '#1a1a1a'}
              />
            </div>
          </div>

          {/* CSV Datasets */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <div style={labelStyle}>TEST DATASET (CSV) - 99.99k ticks</div>
              <label style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: round.testDataName ? '#10b981' : '#555' }}>
                <Upload size={14} /> {round.testDataName || 'Upload Test CSV...'}
                <input type="file" accept=".csv" style={{ display: 'none' }} onChange={async (e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  if (!round.id) { alert("Please save contest first before uploading"); return; }
                  
                  try {
                    onChange({ ...round, testDataName: 'Uploading...' });
                    const res = await uploadRoundDataset(round.id, file, false);
                    onChange({ ...round, testDataName: file.name, testDataKey: res.path });
                  } catch (err) {
                    alert('Upload failed: ' + err.message);
                    onChange({ ...round, testDataName: null });
                  }
                }} />
              </label>
            </div>
            <div>
              <div style={labelStyle}>FINAL EVAL DATASET (CSV) - 999.99k ticks</div>
              <label style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: round.finalDataName ? '#10b981' : '#555' }}>
                <Upload size={14} /> {round.finalDataName || 'Upload Final CSV...'}
                <input type="file" accept=".csv" style={{ display: 'none' }} onChange={async (e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  if (!round.id) { alert("Please save contest first before uploading"); return; }

                  try {
                    onChange({ ...round, finalDataName: 'Uploading...' });
                    const res = await uploadRoundDataset(round.id, file, true);
                    onChange({ ...round, finalDataName: file.name, finalDataKey: res.path });
                  } catch (err) {
                    alert('Upload failed: ' + err.message);
                    onChange({ ...round, finalDataName: null });
                  }
                }} />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Monitor panel (live scores for a contest) ───────────────────────────────
function MonitorPanel({ contest }) {
  const lb = ContestStore.getLeaderboard(contest.id);
  const [evaluating, setEvaluating] = useState(false);
  
  const handleFinalEvaluation = async () => {
    setEvaluating(true);
    try {
      const activeOrEndedRound = contest.rounds.find(r => r.status === 'active' || r.status === 'ended');
      if (!activeOrEndedRound) {
        alert("No round to evaluate.");
        setEvaluating(false);
        return;
      }

      await triggerFinalEvaluation(activeOrEndedRound.id);
      
      alert("Final Evaluation started on backend! Monitor leaderboard for updates.");
    } catch (e) {
      console.error(e);
      alert("Evaluation failed: " + e.message);
    }
    setEvaluating(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1px', backgroundColor: '#111' }}>
        {[
          { label: 'PARTICIPANTS', value: contest.participants.length },
          { label: 'ACTIVE ROUND', value: contest.rounds.find(r => r.status === 'active')?.name?.split('—')[0] ?? 'None' },
          { label: 'STATUS', value: contest.status.toUpperCase() },
        ].map(s => (
          <div key={s.label} style={{ backgroundColor: '#050505', padding: '12px' }}>
            <div style={{ ...mono, fontSize: '0.55rem', color: '#555', letterSpacing: '1px', marginBottom: '3px' }}>{s.label}</div>
            <div style={{ ...mono, fontSize: '0.9rem', color: 'var(--text-bright)', fontWeight: 600 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Leaderboard snapshot */}
      <div style={{ backgroundColor: '#050505', border: '1px solid #111', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #111',
          ...mono, fontSize: '0.65rem', color: '#555', letterSpacing: '1.5px' }}>
          STUDENT LEADERBOARD (LIVE)
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['RANK', 'NAME', 'TEAM', 'PnL%', 'p99', 'R1', 'R2', 'R3'].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', ...mono,
                  fontSize: '0.6rem', color: '#444', letterSpacing: '1px', fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lb.map((e, i) => {
              const myId = ContestStore.state.studentId || 'me';
              const isMe = e.id === myId;
              const pos = e.pnlPct >= 0;
              return (
                <tr key={e.id} style={{
                  borderTop: '1px solid #0a0a0a',
                  backgroundColor: isMe ? 'rgba(168,85,247,0.04)' : 'transparent'
                }}>
                  <td style={{ padding: '10px 12px', ...mono, fontSize: '0.75rem', color: i < 3 ? ['#f59e0b','#94a3b8','#cd7c2e'][i] : '#555' }}>#{e.rank}</td>
                  <td style={{ padding: '10px 12px', ...mono, fontSize: '0.75rem', color: isMe ? '#a855f7' : 'var(--text-bright)' }}>
                    {e.name} {isMe && <span style={{ color: '#a855f7', fontSize: '0.6rem' }}>● YOU</span>}
                  </td>
                  <td style={{ padding: '10px 12px', ...mono, fontSize: '0.7rem', color: '#555' }}>{e.team || '—'}</td>
                  <td style={{ padding: '10px 12px', ...mono, fontSize: '0.8rem', fontWeight: 700,
                    color: pos ? '#10b981' : '#e11d48' }}>
                    {pos ? '+' : ''}{(e.pnlPct || 0).toFixed(3)}%
                  </td>
                  <td style={{ padding: '10px 12px', ...mono, fontSize: '0.7rem', color: '#666' }}>
                    {e.p99 ? `${e.p99}ns` : '—'}
                  </td>
                  {[0, 1, 2].map(ri => (
                    <td key={ri} style={{ padding: '10px 12px', ...mono, fontSize: '0.7rem',
                      color: (e.rounds?.[ri] ?? null) === null ? '#333' : e.rounds[ri] >= 0 ? '#10b981' : '#e11d48' }}>
                      {(e.rounds?.[ri] ?? null) !== null ? `${e.rounds[ri] >= 0 ? '+' : ''}${e.rounds[ri].toFixed(2)}%` : '—'}
                    </td>
                  ))}
                </tr>
              );
            })}
            {lb.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: '#333', ...mono, fontSize: '0.75rem' }}>
                No submissions yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
        <button 
          onClick={handleFinalEvaluation}
          disabled={evaluating || contest.status !== 'ended'}
          style={{
            padding: '10px 16px', backgroundColor: contest.status === 'ended' ? (evaluating ? '#333' : '#a855f7') : '#333',
            color: '#fff', border: 'none', cursor: contest.status === 'ended' && !evaluating ? 'pointer' : 'not-allowed',
            ...mono, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px', opacity: contest.status === 'ended' ? 1 : 0.5
          }}
        >
          {evaluating ? <Clock size={14} className="spin" /> : <Play size={14} fill="currentColor" />}
          {evaluating ? 'RUNNING EVALUATION ON 999.99k TICKS...' : 'TRIGGER FINAL EVALUATION'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Creator Dashboard ───────────────────────────────────────────────────
const BLANK_ROUND = {
  name: '', description: '',
  tickCount: 100000, positionLimit: 1000, startingCapital: 100000,
  activeBots: ['MM', 'NOISE'], botAggressiveness: 0.5,
  asset: { name: 'VIDHI-1', basePrice: 1500, volatility: 'MEDIUM' },
  startAt: '', endAt: '',
};

export default function ContestCreator() {
  const navigate = useNavigate();
  const [tab, setTab]           = useState('contests');   // 'contests' | 'create' | 'monitor' | 'bots'
  const [storeState, setStoreState] = useState(ContestStore.state);
  const [monitorTarget, setMonitorTarget] = useState(null);
  const [saveAnim, setSaveAnim] = useState(false);

  const availableBots = [
    ...BOT_OPTS,
    ...(storeState.customBots || []).map(b => ({
      id: b.id, name: b.name, color: '#10b981', desc: 'Custom GM Bot'
    }))
  ];

  // Form state for new contest
  const [form, setForm] = useState({
    name: '', description: '', endsAt: '',
    maxParticipants: 200,
    rounds: [{ ...BLANK_ROUND, name: 'Round 1 — Intro' }],
  });

  useEffect(() => {
    return ContestStore.subscribe(s => setStoreState({ ...s }));
  }, []);

  const updateRound = (i, data) => {
    const rounds = [...form.rounds];
    rounds[i] = data;
    setForm(f => ({ ...f, rounds }));
  };

  const deleteRound = (i) => {
    setForm(f => ({ ...f, rounds: f.rounds.filter((_, ri) => ri !== i) }));
  };

  const addRound = () => {
    setForm(f => ({ ...f, rounds: [...f.rounds, { ...BLANK_ROUND, name: `Round ${f.rounds.length + 1}` }] }));
  };

  const saveContest = async (publish = false) => {
    if (!form.name.trim()) return;
    
    // We need to wait for the backend to create the contest and rounds
    // so we can get their IDs (required for uploading CSVs).
    const createdContest = await ContestStore.createContest({
      ...form,
      status: publish ? 'active' : 'draft',
    });
    
    // The createContest method in ContestStore mutates the object we pass it,
    // but the backend creation happens asynchronously, so we fetch the updated
    // version from the store to update our form state.
    const saved = ContestStore.getContest(createdContest);
    if (saved) {
      setForm({ ...saved });
    }
    
    setSaveAnim(true);
    setTimeout(() => setSaveAnim(false), 1500);
    if (publish) setTab('contests');
  };

  const allContests = storeState.contests;

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000',
      overflowY: 'auto', padding: '28px 32px', boxSizing: 'border-box' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <Settings size={18} color="#f59e0b" />
          <div>
            <div style={{ color: 'var(--text-bright)', ...mono, fontSize: '0.9rem', letterSpacing: '3px' }}>
              CREATOR DASHBOARD
            </div>
            <div style={{ color: '#555', ...mono, fontSize: '0.6rem', marginTop: '2px', letterSpacing: '1px' }}>
              VIDHI ARENA — ADMIN
            </div>
          </div>
        </div>
        <button onClick={() => { ContestStore.setRole(null); navigate('/select-role'); }} style={{
          background: 'transparent', border: '1px solid #222', color: '#555',
          padding: '7px 14px', cursor: 'pointer', ...mono, fontSize: '0.65rem',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <LogOut size={11} /> EXIT
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '1px', backgroundColor: '#111', marginBottom: '24px', width: 'fit-content' }}>
        {[
          { key: 'contests', label: 'MY CONTESTS', icon: <Trophy size={13} /> },
          { key: 'create',   label: 'CREATE NEW',  icon: <Plus size={13} /> },
          { key: 'monitor',  label: 'MONITOR',     icon: <BarChart3 size={13} /> },
          { key: 'bots',     label: 'CUSTOM BOTS', icon: <Bot size={13} /> },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '9px 20px', border: 'none', cursor: 'pointer',
            backgroundColor: tab === t.key ? '#0a0a0a' : '#050505',
            color: tab === t.key ? '#f59e0b' : '#444',
            ...mono, fontSize: '0.7rem', letterSpacing: '1.5px',
            display: 'flex', alignItems: 'center', gap: '7px',
            borderBottom: tab === t.key ? '2px solid #f59e0b' : '2px solid transparent',
            transition: 'all 0.15s',
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: MY CONTESTS ─────────────────────────────────────────── */}
      {tab === 'contests' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: 900 }}>
          {allContests.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#333', padding: '60px', ...mono, fontSize: '0.8rem' }}>
              No contests yet. Create one.
            </div>
          ) : (
            allContests.map(c => (
              <div key={c.id} style={{ backgroundColor: '#080808', border: '1px solid #1a1a1a',
                padding: '18px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                    <span style={{ ...mono, fontSize: '0.85rem', color: 'var(--text-bright)', fontWeight: 600 }}>{c.name}</span>
                    <span style={{
                      padding: '2px 7px', ...mono, fontSize: '0.6rem',
                      color: c.status === 'active' ? '#10b981' : c.status === 'ended' ? '#e11d48' : '#555',
                      border: `1px solid ${c.status === 'active' ? '#10b98140' : c.status === 'ended' ? '#e11d4840' : '#222'}`,
                    }}>{c.status.toUpperCase()}</span>
                  </div>
                  <div style={{ ...mono, fontSize: '0.65rem', color: '#444' }}>
                    {c.rounds.length} rounds · {c.participants.length} participants · Created {new Date(c.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => { setMonitorTarget(c.id); setTab('monitor'); }}
                    style={{ padding: '7px 12px', background: 'transparent', border: '1px solid #222',
                      color: '#555', cursor: 'pointer', ...mono, fontSize: '0.65rem',
                      display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Eye size={11} /> MONITOR
                  </button>
                  {c.status === 'draft' && (
                    <button onClick={() => ContestStore.publishContest(c.id)}
                      style={{ padding: '7px 12px', background: 'transparent', border: '1px solid #10b981',
                        color: '#10b981', cursor: 'pointer', ...mono, fontSize: '0.65rem',
                        display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Play size={11} fill="currentColor" /> PUBLISH
                    </button>
                  )}
                  {c.status === 'active' && (
                    <button onClick={() => ContestStore.endContest(c.id)}
                      style={{ padding: '7px 12px', background: 'transparent', border: '1px solid #e11d48',
                        color: '#e11d48', cursor: 'pointer', ...mono, fontSize: '0.65rem',
                        display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Pause size={11} /> END
                    </button>
                  )}
                  <button onClick={() => ContestStore.deleteContest(c.id)}
                    style={{ padding: '7px 10px', background: 'transparent', border: '1px solid #1a1a1a',
                      color: '#333', cursor: 'pointer', transition: 'color 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#e11d48'}
                    onMouseLeave={e => e.currentTarget.style.color = '#333'}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
          <button onClick={() => setTab('create')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              padding: '12px', border: '1px dashed #222', background: 'transparent',
              color: '#555', cursor: 'pointer', ...mono, fontSize: '0.75rem',
              transition: 'all 0.15s', marginTop: '4px' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#f59e0b'; e.currentTarget.style.color = '#f59e0b'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#222'; e.currentTarget.style.color = '#555'; }}>
            <Plus size={14} /> CREATE NEW CONTEST
          </button>
        </div>
      )}

      {/* ── Tab: CREATE NEW ──────────────────────────────────────────── */}
      {tab === 'create' && (
        <div style={{ maxWidth: 860, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Contest meta */}
          <div style={{ backgroundColor: '#080808', border: '1px solid #1a1a1a', padding: '20px',
            display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ ...mono, fontSize: '0.65rem', color: '#f59e0b', letterSpacing: '2px' }}>CONTEST DETAILS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <div style={labelStyle}>CONTEST NAME</div>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  style={inputStyle} placeholder="e.g. IICPC Prosperity 2027"
                  onFocus={e => e.target.style.borderColor = '#f59e0b'}
                  onBlur={e => e.target.style.borderColor = '#1a1a1a'} />
              </div>
              <div>
                <div style={labelStyle}>END DATE</div>
                <input type="datetime-local" value={form.endsAt}
                  onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))}
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = '#f59e0b'}
                  onBlur={e => e.target.style.borderColor = '#1a1a1a'} />
              </div>
            </div>
            <div>
              <div style={labelStyle}>DESCRIPTION</div>
              <textarea value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                style={{ ...inputStyle, height: 70, resize: 'vertical', lineHeight: 1.5 }}
                placeholder="Describe the contest goals, difficulty, and theme..."
                onFocus={e => e.target.style.borderColor = '#f59e0b'}
                onBlur={e => e.target.style.borderColor = '#1a1a1a'} />
            </div>
            <div>
              <div style={labelStyle}>MAX PARTICIPANTS</div>
              <input type="number" value={form.maxParticipants}
                onChange={e => setForm(f => ({ ...f, maxParticipants: parseInt(e.target.value) }))}
                style={{ ...inputStyle, width: 120 }}
                onFocus={e => e.target.style.borderColor = '#f59e0b'}
                onBlur={e => e.target.style.borderColor = '#1a1a1a'} />
            </div>
          </div>

          {/* Round builder */}
          <div style={{ ...mono, fontSize: '0.65rem', color: '#555', letterSpacing: '2px' }}>
            ROUNDS ({form.rounds.length})
          </div>
          {form.rounds.map((r, i) => (
            <RoundBuilder key={i} round={r} roundIndex={i}
              availableBots={availableBots}
              onChange={data => updateRound(i, data)}
              onDelete={() => deleteRound(i)} />
          ))}
          <button onClick={addRound} style={{
            padding: '10px', border: '1px dashed #1a1a1a', background: 'transparent',
            color: '#444', cursor: 'pointer', ...mono, fontSize: '0.7rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#a855f7'; e.currentTarget.style.color = '#a855f7'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.color = '#444'; }}>
            <Plus size={13} /> ADD ROUND
          </button>

          {/* Save actions */}
          <div style={{ display: 'flex', gap: '10px', paddingTop: '8px', borderTop: '1px solid #111' }}>
            <button onClick={() => saveContest(false)} style={{
              padding: '11px 22px', background: 'transparent', border: '1px solid #333',
              color: '#666', cursor: 'pointer', ...mono, fontSize: '0.75rem',
              display: 'flex', alignItems: 'center', gap: '7px',
            }}>
              <Save size={13} /> SAVE AS DRAFT
            </button>
            <button onClick={() => saveContest(true)} disabled={!form.name.trim()} style={{
              padding: '11px 22px', background: form.name.trim() ? 'transparent' : '#050505',
              border: `1px solid ${form.name.trim() ? '#10b981' : '#1a1a1a'}`,
              color: form.name.trim() ? '#10b981' : '#333',
              cursor: form.name.trim() ? 'pointer' : 'not-allowed', ...mono, fontSize: '0.75rem',
              display: 'flex', alignItems: 'center', gap: '7px', transition: 'all 0.15s',
            }}
            onMouseEnter={e => form.name.trim() && (e.currentTarget.style.backgroundColor = '#10b98115')}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
              {saveAnim ? <CheckCircle size={13} /> : <Play size={13} fill="currentColor" />}
              {saveAnim ? 'PUBLISHED!' : 'PUBLISH CONTEST'}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: MONITOR ──────────────────────────────────────────────── */}
      {tab === 'monitor' && (
        <div style={{ maxWidth: 960 }}>
          {/* Contest selector */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {allContests.map(c => (
              <button key={c.id} onClick={() => setMonitorTarget(c.id)} style={{
                padding: '7px 14px', background: 'transparent',
                border: `1px solid ${monitorTarget === c.id ? '#f59e0b' : '#222'}`,
                color: monitorTarget === c.id ? '#f59e0b' : '#555',
                cursor: 'pointer', ...mono, fontSize: '0.7rem', transition: 'all 0.15s',
              }}>
                {c.name}
              </button>
            ))}
          </div>
          {monitorTarget ? (
            <MonitorPanel contest={ContestStore.getContest(monitorTarget)} />
          ) : (
            <div style={{ color: '#333', textAlign: 'center', padding: '60px', ...mono, fontSize: '0.8rem' }}>
              Select a contest to monitor.
            </div>
          )}
        </div>
      )}

      {/* ── Tab: CUSTOM BOTS ────────────────────────────────────────────── */}
      {tab === 'bots' && (
        <div style={{ maxWidth: 860, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: '#080808', border: '1px dashed #333', padding: '40px', textAlign: 'center', borderRadius: '8px' }}>
            <Bot size={48} color="#a855f7" style={{ marginBottom: '16px' }} />
            <h3 style={{ ...mono, color: 'var(--text-bright)', marginBottom: '8px' }}>Upload Custom GM Bot</h3>
            <p style={{ ...mono, color: '#555', fontSize: '0.8rem', marginBottom: '24px' }}>
              Drag and drop a .py bot script here, or click to select a file.
            </p>
            <label style={{ ...inputStyle, display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', width: 'auto', backgroundColor: '#a855f720', color: '#a855f7', border: '1px solid #a855f7' }}>
              <Upload size={16} /> SELECT .PY FILE
              <input type="file" accept=".py" style={{ display: 'none' }} onChange={async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const text = await file.text();
                const name = file.name.replace('.py', '').toUpperCase();
                ContestStore.addCustomBot(name, text);
                e.target.value = '';
              }} />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
            {(storeState.customBots || []).map(b => (
              <div key={b.id} style={{ backgroundColor: '#050505', border: '1px solid #1a1a1a', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ ...mono, color: '#10b981', fontWeight: 600 }}>{b.name}</span>
                  <button onClick={() => ContestStore.removeCustomBot(b.id)} style={{ background: 'transparent', border: 'none', color: '#e11d48', cursor: 'pointer' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div style={{ ...mono, fontSize: '0.65rem', color: '#555', maxHeight: '100px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {b.code.substring(0, 150)}...
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
