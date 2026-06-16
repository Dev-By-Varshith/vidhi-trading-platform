import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Crown, BadgeCheck, Search } from 'lucide-react';
import ContestStore from '../store/ContestStore';

export default function SidebarLeaderboard({ isOpen }) {
  const location = useLocation();
  const isSimulationPage = location.pathname.includes('/simulation');
  
  const [data, setData] = useState([]);

  useEffect(() => {
    async function fetchLB() {
      try {
        const activeRoundId = ContestStore.getActiveRoundId();
        const url = activeRoundId ? `/api/leaderboard?round_id=${activeRoundId}` : '/api/leaderboard';
        const res = await fetch(url);
        if (res.ok) {
          const rows = await res.json();
          setData(rows.slice(0, 50).map((r, i) => ({
            rank: r.rank || (i + 1),
            name: r.display_name || r.user_id || 'Anonymous',
            verified: true,
            pnlPct: (r.pnl_pct || 0).toFixed(2) + '%',
            fills: r.total_fills ? (r.total_fills / 1000).toFixed(1) + 'K' : '0K',
            isMe: false, // Could check against ContestStore state
            type: ''
          })));
          return;
        }
      } catch (e) {
        // Fall back to local store if backend offline
        const contestId = ContestStore.state.activeContestId;
        const local = ContestStore.getLeaderboard(contestId);
        setData(local.map((r, i) => ({
          rank: i + 1,
          name: r.name || r.id,
          verified: true,
          pnlPct: (r.pnlPct || 0).toFixed(2) + '%',
          fills: r.fills ? (r.fills / 1000).toFixed(1) + 'K' : '0K',
          isMe: false,
          type: ''
        })));
      }
    }
    
    fetchLB();
    const interval = setInterval(fetchLB, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`leaderboard-drawer ${isOpen ? 'open' : ''}`}>
      <div style={{ padding: '16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', margin: 0 }}>
          {isSimulationPage ? 'Actual Leaderboard' : 'Test Leaderboard'}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '4px 8px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginRight: '8px' }}>Filter:</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.8rem', color: '#fff' }}>Search</span>
            <Search size={12} color="var(--text-secondary)" />
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '45px 1fr 65px 65px', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
        <div>Rank</div>
        <div>Contestant</div>
        <div style={{ textAlign: 'right' }}>PnL %</div>
        <div style={{ textAlign: 'right' }}>Fills</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 16px 8px' }}>
        {data.map((row, index) => {
          const isBlueActive = row.type === 'blue_active';

          return (
            <div 
              key={index}
              style={{ 
                display: 'grid', gridTemplateColumns: '45px 1fr 65px 65px', alignItems: 'center',
                padding: '10px 8px', borderRadius: '6px', cursor: 'pointer',
                backgroundColor: isBlueActive ? '#1D5CFF' : 'transparent',
                marginBottom: '4px',
                transition: 'background-color 0.2s'
              }}
            >
              {/* Rank Icon or Badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
                {row.rank === 1 ? (
                  <Crown size={18} color="#FFD700" fill="#FFD700" style={{ filter: 'drop-shadow(0 0 3px rgba(255, 215, 0, 0.5))' }} />
                ) : row.rank === 2 ? (
                  <Crown size={18} color="#C0C0C0" fill="#C0C0C0" style={{ filter: 'drop-shadow(0 0 3px rgba(192, 192, 192, 0.4))' }} />
                ) : row.rank === 3 ? (
                  <Crown size={18} color="#CD7C2E" fill="#CD7C2E" style={{ filter: 'drop-shadow(0 0 3px rgba(205, 124, 46, 0.4))' }} />
                ) : (
                  <span style={{ fontSize: '0.8rem', color: isBlueActive ? '#fff' : 'var(--text-secondary)', fontWeight: 600, paddingLeft: '6px' }}>
                    {row.rank}
                  </span>
                )}
              </div>

              {/* Contestant info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ 
                  width: 24, height: 24, borderRadius: '50%', 
                  backgroundColor: isBlueActive ? 'rgba(255,255,255,0.2)' : 'var(--bg-panel-hover)', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center' 
                }}>
                  <span style={{ fontSize: '0.7rem', color: isBlueActive ? '#fff' : 'var(--text-secondary)', fontWeight: 'bold' }}>
                    {row.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {row.name}
                  {row.verified && (
                    <BadgeCheck 
                      size={13} 
                      color={isBlueActive ? "#1D5CFF" : "var(--accent-blue)"} 
                      fill={isBlueActive ? "#fff" : "#fff"} 
                    />
                  )}
                </div>
              </div>

              {/* Data fields */}
              <div style={{ textAlign: 'right', fontSize: '0.8rem', color: '#fff' }}>{row.pnlPct}</div>
              <div style={{ textAlign: 'right', fontSize: '0.8rem', color: isBlueActive ? '#fff' : 'var(--text-secondary)' }}>
                {row.fills}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
