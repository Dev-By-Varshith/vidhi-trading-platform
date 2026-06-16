import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Menu, Files, Search, GitBranch, PlayCircle, Puzzle, FlaskConical, Target, Settings, Bell, LayoutGrid, Sidebar } from 'lucide-react';
import SidebarLeaderboard from './SidebarLeaderboard';
import ContestStore from '../store/ContestStore';
import { useNavigate } from 'react-router-dom';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [storeState, setStoreState] = useState(ContestStore.state);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [myRank, setMyRank] = useState('N/A');
  const [timeLeft, setTimeLeft] = useState(() => {
    const saved = sessionStorage.getItem('contestEndTime');
    if (saved) {
      const remaining = Math.floor((parseInt(saved) - Date.now()) / 1000);
      return remaining > 0 ? remaining : 0;
    }
    const end = Date.now() + 24 * 3600 * 1000;
    sessionStorage.setItem('contestEndTime', end.toString());
    return 24 * 3600;
  });

  useEffect(() => {
    if (timeLeft <= 0) {
      if (location.pathname !== '/calculating' && !location.pathname.startsWith('/leaderboard')) {
        navigate('/calculating');
      }
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, navigate, location.pathname]);

  useEffect(() => {
    const updateRank = (state) => {
      setStoreState({ ...state });
      if (state.activeContestId) {
        const lb = ContestStore.getLeaderboard(state.activeContestId);
        const myId = state.studentId || 'me';
        const me = lb.find(p => p.id === myId);
        setMyRank(me?.rank ? `#${me.rank}` : 'N/A');
      }
    };
    const unsub = ContestStore.subscribe(updateRank);
    return unsub;
  }, []);

  const IconLink = ({ to, icon: Icon, label }) => {
    const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
    return (
      <Link to={to} className={`sidebar-icon ${isActive ? 'active' : ''}`} title={label} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '40px', height: '40px', borderRadius: '8px',
        color: isActive ? 'var(--accent-blue)' : 'var(--text-secondary)',
        backgroundColor: isActive ? 'rgba(50, 107, 255, 0.08)' : 'transparent',
        transition: 'all 0.2s', marginBottom: '8px'
      }}>
        <Icon size={20} />
      </Link>
    );
  };

  return (
    <div className="app-container" style={{ display: 'flex', height: '100vh', backgroundColor: '#000', overflow: 'hidden' }}>
      
      {/* ─── LEFT SIDEBAR (ICONS) ─────────────────────────────────── */}
      <div className="icon-sidebar" style={{
        width: '60px', backgroundColor: '#0A0B0D', borderRight: '1px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 0', boxSizing: 'border-box'
      }}>
        {/* Top Hamburger Menu */}
        <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', marginBottom: '24px' }}>
          <Menu size={20} />
        </button>

        {/* Sidebar Nav Icons */}
        <IconLink to="/" icon={Files} label="Code Arena" />
        <IconLink to="/simulation" icon={Search} label="Simulation Dashboard" />
        <IconLink to="/wiki" icon={Target} label="Tournament Wiki" />

        <div style={{ flex: 1 }} />

        {/* Bottom Icons */}
        <IconLink to="/lobby" icon={Settings} label="Back to Lobby" />
        <div style={{
          width: '36px', height: '36px', borderRadius: '50%',
          backgroundColor: '#1d5cff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', border: '2px solid rgba(255,255,255,0.2)', boxShadow: '0 0 12px rgba(29,92,255,0.5)'
        }} title="My Profile">
          {(storeState.studentName || 'U')[0].toUpperCase()}
        </div>
      </div>

      {/* ─── MAIN WRAPPER ─────────────────────────────────────────── */}
      <div className="main-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* MAIN TOP NAVBAR */}
        <div className="top-navbar" style={{
          height: '60px', backgroundColor: '#0A0B0D', borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', boxSizing: 'border-box'
        }}>
          {/* Brand Logo & Title */}
          <div className="nav-left" style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <img 
              src="/logo.png" 
              alt="Project Vidhi" 
              style={{ height: '50px', objectFit: 'contain', marginRight: '16px', marginTop: '4px' }} 
            />
            <button style={{ 
              marginLeft: '16px', backgroundColor: '#1A1D24', border: '1px solid #2D3342', 
              color: '#fff', padding: '6px 16px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer' 
            }}>
              Dashboard
            </button>
          </div>
          
          {/* Right stats and profile */}
          <div className="nav-right" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Contest Countdown Timer */}
            {timeLeft > 0 && (
              <div style={{ 
                fontFamily: "'Bebas Neue', 'Oswald', 'Roboto Condensed', sans-serif",
                display: 'flex', 
                alignItems: 'baseline',
                marginRight: '8px'
              }}>
                <span style={{ color: '#fff', fontWeight: 500, fontSize: '2.4rem', letterSpacing: '1px' }}>
                  {Math.floor(timeLeft / 3600).toString().padStart(2, '0')}:{Math.floor((timeLeft % 3600) / 60).toString().padStart(2, '0')}
                </span>
                <span style={{ color: 'var(--accent-blue)', fontWeight: 600, fontSize: '1.4rem', marginLeft: '2px', letterSpacing: '1px' }}>
                  :{(timeLeft % 60).toString().padStart(2, '0')}
                </span>
              </div>
            )}

            {/* Star badge */}
            <div style={{ 
              display: 'flex', alignItems: 'center', gap: '6px', 
              backgroundColor: '#151922', border: '1px solid #232a3b', 
              padding: '6px 12px', borderRadius: '6px', color: '#fff', fontSize: '0.8rem', fontWeight: 600 
            }}>
              <span style={{ color: 'var(--gold)' }}>★</span> {myRank} GLOBAL
            </div>

            {/* Notification bell */}
            <div style={{ 
              position: 'relative', cursor: 'pointer', display: 'flex', alignItems: 'center', 
              justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', 
              backgroundColor: 'rgba(255,255,255,0.02)' 
            }}>
              <Bell size={16} color="var(--text-secondary)" />
              <div style={{ 
                position: 'absolute', top: '-1px', right: '-1px', width: '13px', height: '13px', 
                backgroundColor: '#FF3B30', borderRadius: '50%', display: 'flex', alignItems: 'center', 
                justifyContent: 'center', fontSize: '0.6rem', color: '#fff', fontWeight: 'bold' 
              }}>31</div>
            </div>

            {/* Layout Toggle */}
            <button 
              onClick={() => setIsLeaderboardOpen(!isLeaderboardOpen)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px' }}
            >
              <LayoutGrid size={18} color={isLeaderboardOpen ? "var(--accent-blue)" : "var(--text-secondary)"} />
            </button>
          </div>
        </div>

        {/* WORKSPACE AREA (SPLIT VIEW) */}
        <div className={`content-split ${isLeaderboardOpen ? 'drawer-open' : ''}`} style={{
          flex: 1, display: 'flex', overflow: 'hidden'
        }}>
          {/* CENTER CONTENT */}
          <div className="center-pane" style={{
            flex: 1, display: 'flex', flexDirection: 'column', padding: '16px', boxSizing: 'border-box', overflowY: 'auto'
          }}>
            
            {/* WORKSPACE SUB-HEADER (Dashboard | Logs | Settings) */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
              borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '12px', marginBottom: '16px'
            }}>
              {/* Left tab pill buttons */}
              <div style={{ display: 'flex', gap: '24px' }}>
                <div onClick={() => setActiveTab('dashboard')} style={{ 
                  color: activeTab === 'dashboard' ? '#fff' : 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: activeTab === 'dashboard' ? 600 : 500, cursor: 'pointer',
                  position: 'relative', paddingBottom: '14px', marginBottom: '-13px',
                  borderBottom: activeTab === 'dashboard' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                  transition: 'all 0.2s'
                }}>
                  Dashboard
                </div>
                <div onClick={() => setActiveTab('logs')} style={{ 
                  color: activeTab === 'logs' ? '#fff' : 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: activeTab === 'logs' ? 600 : 500, cursor: 'pointer',
                  position: 'relative', paddingBottom: '14px', marginBottom: '-13px',
                  borderBottom: activeTab === 'logs' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                  transition: 'all 0.2s'
                }}>
                  Logs
                </div>
                <div onClick={() => setActiveTab('settings')} style={{ 
                  color: activeTab === 'settings' ? '#fff' : 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: activeTab === 'settings' ? 600 : 500, cursor: 'pointer',
                  position: 'relative', paddingBottom: '14px', marginBottom: '-13px',
                  borderBottom: activeTab === 'settings' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                  transition: 'all 0.2s'
                }}>
                  Settings
                </div>
              </div>

              {/* Right action controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button style={{
                  backgroundColor: '#1E232B', border: '1px solid #2D3342', color: 'var(--accent-green)',
                  padding: '6px 12px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 500
                }}>
                  Low Latency
                </button>
                <button style={{
                  backgroundColor: '#1E232B', border: '1px solid #2D3342', color: '#fff',
                  padding: '6px 12px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 500
                }}>
                  Edit
                </button>
                <button style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', padding: '4px' }}>
                  <LayoutGrid size={16} />
                </button>
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {activeTab === 'dashboard' && <Outlet />}
              {activeTab === 'logs' && (
                <div style={{ flex: 1, backgroundColor: '#050505', color: '#10b981', fontFamily: "'Roboto Mono', monospace", padding: '16px', fontSize: '0.85rem', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px' }}>
                  <div style={{ color: '#555', marginBottom: '8px' }}>--- TERMINAL SESSION INITIATED ---</div>
                  <div>&gt; Connection established with Vidhi Backend... OK</div>
                  <div>&gt; Subscribed to Market Data stream (wss://stream.vidhi.dev/lob)... OK</div>
                  <div>&gt; Ready to receive tick data.</div>
                  <div className="blink" style={{ animation: 'blink 1s step-end infinite', marginTop: '4px' }}>_</div>
                  <style dangerouslySetInnerHTML={{__html: `@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }`}} />
                </div>
              )}
              {activeTab === 'settings' && (
                <div style={{ flex: 1, padding: '24px', color: '#fff', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px' }}>
                  <h3 style={{ margin: '0 0 24px 0', fontSize: '1.2rem', fontWeight: 500 }}>Trading Preferences</h3>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div>
                        <div style={{ fontWeight: 500, marginBottom: '4px' }}>Low Latency Mode</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Disable heavy UI animations for maximum performance</div>
                      </div>
                      <div style={{ width: '40px', height: '24px', backgroundColor: 'var(--accent-blue)', borderRadius: '12px', position: 'relative', cursor: 'pointer' }}>
                        <div style={{ width: '18px', height: '18px', backgroundColor: '#fff', borderRadius: '50%', position: 'absolute', right: '3px', top: '3px' }}></div>
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div>
                        <div style={{ fontWeight: 500, marginBottom: '4px' }}>Dark Theme Editor</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Use high-contrast theme in the Code Arena</div>
                      </div>
                      <div style={{ width: '40px', height: '24px', backgroundColor: 'var(--accent-blue)', borderRadius: '12px', position: 'relative', cursor: 'pointer' }}>
                        <div style={{ width: '18px', height: '18px', backgroundColor: '#fff', borderRadius: '50%', position: 'absolute', right: '3px', top: '3px' }}></div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT LEADERBOARD DRAWER */}
          <SidebarLeaderboard isOpen={isLeaderboardOpen} />
        </div>
      </div>
    </div>
  );
}
