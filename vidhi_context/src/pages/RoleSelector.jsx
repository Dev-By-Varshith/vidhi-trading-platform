// src/pages/RoleSelector.jsx
// Production-grade landing page — choose role before entering the platform

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Code2, Shield, ChevronRight, User, Users } from 'lucide-react';
import ContestStore from '../store/ContestStore';

const CREATOR_PASSCODE = 'vidhi-admin';

export default function RoleSelector() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('student');
  const [name, setName] = useState('');
  const [team, setTeam] = useState('');
  const [passcode, setPasscode] = useState('');
  const [passError, setPassError] = useState(false);
  const [loading, setLoading] = useState(false);

  const enterAsStudent = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    await ContestStore.setRole('student', name.trim(), team.trim());
    navigate('/lobby');
  };

  const enterAsCreator = (e) => {
    e.preventDefault();
    if (passcode !== CREATOR_PASSCODE) { 
      setPassError(true); 
      setTimeout(() => setPassError(false), 3000);
      return; 
    }
    ContestStore.setRole('creator', 'Contest Creator', '');
    navigate('/creator');
  };

  return (
    <div style={{
      width: '100vw', height: '100vh', backgroundColor: '#000',
      display: 'flex', overflow: 'hidden'
    }}>
      {/* Left Side: Brand Showcase */}
      <div style={{
        flex: 1, position: 'relative', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'radial-gradient(circle at center, rgba(0, 198, 255, 0.05) 0%, transparent 70%)',
        borderRight: '1px solid rgba(255,255,255,0.05)'
      }}>
        <img src="/logo.png" alt="Project Vidhi" style={{ width: '60%', maxWidth: '500px', objectFit: 'contain' }} />
        <div style={{
          position: 'absolute', bottom: '40px', left: '40px', right: '40px',
          color: 'var(--text-muted)', fontSize: '0.85rem', fontFamily: "'Roboto Mono', monospace"
        }}>
          QUANTITATIVE ALGORITHMIC TRADING PLATFORM // V4
        </div>
      </div>

      {/* Right Side: Auth Portal */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '0 10%'
      }}>
        <div style={{ maxWidth: '420px', width: '100%' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '0.5rem', letterSpacing: '-0.5px' }}>
            Initialize Session
          </h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '2.5rem', fontSize: '0.95rem' }}>
            Select your operating mode and authenticate to continue.
          </p>

          {/* Mode Selector */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '2.5rem' }}>
            <button
              onClick={() => setTab('student')}
              style={{
                flex: 1, padding: '12px', background: tab === 'student' ? 'rgba(255,255,255,0.05)' : 'transparent',
                border: `1px solid ${tab === 'student' ? 'var(--brand-cyan)' : 'var(--border-glass)'}`,
                borderRadius: '6px', color: tab === 'student' ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                transition: 'all 0.2s ease', boxShadow: tab === 'student' ? '0 0 15px rgba(0,198,255,0.1)' : 'none'
              }}
            >
              <Code2 size={20} color={tab === 'student' ? 'var(--brand-cyan)' : 'var(--text-dim)'} />
              <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Contestant</span>
            </button>
            <button
              onClick={() => setTab('creator')}
              style={{
                flex: 1, padding: '12px', background: tab === 'creator' ? 'rgba(255,255,255,0.05)' : 'transparent',
                border: `1px solid ${tab === 'creator' ? 'var(--brand-cyan)' : 'var(--border-glass)'}`,
                borderRadius: '6px', color: tab === 'creator' ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                transition: 'all 0.2s ease', boxShadow: tab === 'creator' ? '0 0 15px rgba(0,198,255,0.1)' : 'none'
              }}
            >
              <Shield size={20} color={tab === 'creator' ? 'var(--brand-cyan)' : 'var(--text-dim)'} />
              <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Game Master</span>
            </button>
          </div>

          {/* Auth Forms */}
          {tab === 'student' ? (
            <form onSubmit={enterAsStudent} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>Display Name</label>
                <div style={{ position: 'relative' }}>
                  <User size={16} color="var(--text-dim)" style={{ position: 'absolute', left: '12px', top: '12px' }} />
                  <input
                    type="text"
                    required
                    placeholder="Enter your name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    style={{
                      width: '100%', padding: '12px 12px 12px 36px', background: '#0a0a0a',
                      border: '1px solid var(--border-glass)', borderRadius: '4px',
                      color: '#fff', fontSize: '0.9rem', outline: 'none', transition: 'border-color 0.2s'
                    }}
                    onFocus={e => e.target.style.borderColor = 'var(--brand-cyan)'}
                    onBlur={e => e.target.style.borderColor = 'var(--border-glass)'}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>Team Name (Optional)</label>
                <div style={{ position: 'relative' }}>
                  <Users size={16} color="var(--text-dim)" style={{ position: 'absolute', left: '12px', top: '12px' }} />
                  <input
                    type="text"
                    placeholder="Enter team name"
                    value={team}
                    onChange={e => setTeam(e.target.value)}
                    style={{
                      width: '100%', padding: '12px 12px 12px 36px', background: '#0a0a0a',
                      border: '1px solid var(--border-glass)', borderRadius: '4px',
                      color: '#fff', fontSize: '0.9rem', outline: 'none', transition: 'border-color 0.2s'
                    }}
                    onFocus={e => e.target.style.borderColor = 'var(--brand-cyan)'}
                    onBlur={e => e.target.style.borderColor = 'var(--border-glass)'}
                  />
                </div>
              </div>
              <button type="submit" className="btn-primary btn-connect" style={{ marginTop: '1rem', width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} disabled={loading}>
                {loading ? 'INITIALIZING...' : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="connect-text">CONNECT TO GRID</span> 
                    <div style={{ display: 'flex' }} className="arrows">
                      <ChevronRight size={16} className="arrow-icon a1" />
                      <ChevronRight size={16} className="arrow-icon a2" style={{ marginLeft: '-8px' }} />
                      <ChevronRight size={16} className="arrow-icon a3" style={{ marginLeft: '-8px' }} />
                    </div>
                  </span>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={enterAsCreator} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>Admin Passcode</label>
                <div style={{ position: 'relative' }}>
                  <Settings size={16} color="var(--text-dim)" style={{ position: 'absolute', left: '12px', top: '12px' }} />
                  <input
                    type="password"
                    required
                    placeholder="Enter master passcode"
                    value={passcode}
                    onChange={e => setPasscode(e.target.value)}
                    style={{
                      width: '100%', padding: '12px 12px 12px 36px', background: '#0a0a0a',
                      border: `1px solid ${passError ? '#e11d48' : 'var(--border-glass)'}`, borderRadius: '4px',
                      color: '#fff', fontSize: '0.9rem', outline: 'none', transition: 'border-color 0.2s'
                    }}
                    onFocus={e => e.target.style.borderColor = passError ? '#e11d48' : 'var(--brand-cyan)'}
                    onBlur={e => e.target.style.borderColor = passError ? '#e11d48' : 'var(--border-glass)'}
                  />
                  {passError && <span style={{ color: '#e11d48', fontSize: '0.75rem', position: 'absolute', right: '12px', top: '14px' }}>ACCESS DENIED</span>}
                </div>
                <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(0, 198, 255, 0.08)', border: '1px solid rgba(0, 198, 255, 0.2)', borderRadius: '4px', color: 'var(--text-muted)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                  Hint: Admin passcode is vidhi-admin
                </div>
              </div>
              <button type="submit" className="btn-primary" style={{ marginTop: '1rem', width: '100%', padding: '12px' }}>
                AUTHORIZE <ChevronRight size={16} />
              </button>
            </form>
          )}

        </div>
      </div>
      {/* CSS Animations */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes arrowFlow {
          0% { opacity: 0.2; transform: translateX(-2px); }
          50% { opacity: 1; transform: translateX(0); }
          100% { opacity: 0.2; transform: translateX(2px); }
        }
        .btn-connect:hover .a1 { animation: arrowFlow 0.8s infinite 0s; color: var(--brand-cyan); }
        .btn-connect:hover .a2 { animation: arrowFlow 0.8s infinite 0.15s; color: var(--brand-cyan); }
        .btn-connect:hover .a3 { animation: arrowFlow 0.8s infinite 0.3s; color: var(--brand-cyan); }
        
        @keyframes textGlowSlide {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        .btn-connect:hover .connect-text {
          background: linear-gradient(90deg, #fff 0%, var(--brand-cyan) 50%, #fff 100%);
          background-size: 200% auto;
          color: transparent;
          -webkit-background-clip: text;
          animation: textGlowSlide 1.5s linear infinite;
        }
        .arrow-icon { transition: all 0.2s; }
        .btn-connect .arrows { margin-left: 4px; }
      `}} />
    </div>
  );
}
