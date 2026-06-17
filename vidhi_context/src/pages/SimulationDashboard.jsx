import React, { useState, useEffect, useRef } from 'react';
import { BadgeCheck, Check, ChevronDown, LayoutGrid, MoreHorizontal, Search, Settings2, ShieldCheck, User, Maximize2, Minimize2 } from 'lucide-react';
import { createChart, ColorType, LineSeries, HistogramSeries } from 'lightweight-charts';
import VidhiEngine from '../engine/VidhiEngine';
import ContestStore from '../store/ContestStore';

// ─── Reusable Canvas Chart Component ──────────────────────────────────────────
function LWChart({ data, color, height = 200, priceFormat = 'price', title = '' }) {
  const chartContainerRef = useRef();
  const containerRef = useRef();
  const seriesRef = useRef(null);
  const dataRef = useRef([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const chart = createChart(chartContainerRef.current, { 
      height, 
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#888' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
      timeScale: { 
        timeVisible: true, secondsVisible: false, tickMarkFormatter: (time) => `T${time}`
      },
      localization: {
        timeFormatter: (time) => `Tick ${time}`,
      },
      crosshair: { mode: 1 },
      handleScroll: false,
      handleScale: false,
    });
    
    // Add title if provided
    if (title) {
        chart.applyOptions({ watermark: { visible: true, text: title, color: 'rgba(255, 255, 255, 0.1)', fontSize: 24, horzAlign: 'center', vertAlign: 'center' }});
    }

    let series;
    if (priceFormat === 'volume') {
      series = chart.addSeries(HistogramSeries, { color, priceFormat: { type: 'volume' } });
    } else {
      series = chart.addSeries(LineSeries, { color, lineWidth: 2, crosshairMarkerRadius: 4 });
    }
    
    seriesRef.current = series;

    // High-velocity render loop
    let animationId;
    const render = () => {
      if (seriesRef.current && dataRef.current && dataRef.current.length > 0) {
        // Only update if data changed (naive check by length/last time)
        seriesRef.current.setData(dataRef.current);
      }
      animationId = requestAnimationFrame(render);
    };
    animationId = requestAnimationFrame(render);
    
    return () => {
      cancelAnimationFrame(animationId);
      chart.remove();
    };
  }, [height, color, priceFormat, title]);

  useEffect(() => {
    if (data && data.length > 0) {
      // Remove duplicates by time (lightweight charts requirement)
      const uniqueData = [];
      const seenTimes = new Set();
      for (const d of data) {
        if (!seenTimes.has(d.time)) {
          seenTimes.add(d.time);
          uniqueData.push(d);
        }
      }
      // Sort by time
      uniqueData.sort((a,b) => a.time - b.time);
      dataRef.current = uniqueData;
    }
  }, [data]);

  const toggleFullscreen = () => setIsFullscreen(!isFullscreen);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        width: '100%', 
        height: isFullscreen ? '100vh' : height,
        position: isFullscreen ? 'fixed' : 'relative',
        top: isFullscreen ? 0 : 'auto',
        left: isFullscreen ? 0 : 'auto',
        zIndex: isFullscreen ? 9999 : 1,
        backgroundColor: isFullscreen ? '#0D0F12' : 'transparent',
        padding: isFullscreen ? '20px' : 0,
      }}
    >
      <div 
        onClick={toggleFullscreen}
        style={{ 
          position: 'absolute', 
          top: isFullscreen ? 20 : 10, 
          right: isFullscreen ? 20 : 10, 
          zIndex: 10, 
          cursor: 'pointer',
          padding: '4px',
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: '4px'
        }}
      >
        {isFullscreen ? <Minimize2 size={16} color="#888" /> : <Maximize2 size={16} color="#888" />}
      </div>
      <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

function MetricCard({ label, value, highlight, color, suffix = '' }) {
  const isLoaded = value !== undefined && value !== '—' && value !== null;
  
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', alignItems: 'center' }}>
      <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
        {label}
      </span>
      {isLoaded ? (
        <span style={{ color: color || '#fff', fontWeight: 700 }}>
          {value}{suffix}
        </span>
      ) : (
        <div style={{ 
          width: '40px', height: '14px', backgroundColor: '#1A1D24', borderRadius: '4px',
          animation: 'pulse 1.5s infinite ease-in-out' 
        }} />
      )}
    </div>
  );
}

export default function SimulationDashboard() {
  const [showCharts, setShowCharts] = useState(false);
  const [lamActivePoint, setLamActivePoint] = useState(null);
  const [valActivePoint, setValActivePoint] = useState(null);
  const [streamActivePoint, setStreamActivePoint] = useState(null);
  const [isFinalRound, setIsFinalRound] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [liveState, setLiveState] = useState(null);

  // Active round for commodity label + dataset name
  const activeContest = ContestStore.getActiveContest();
  const activeRoundId = ContestStore.getActiveRoundId();
  const activeRound   = activeContest?.rounds?.find(r => r.id === activeRoundId) || activeContest?.rounds?.[0] || null;
  const commodityName = activeRound?.asset?.name || activeRound?.assetName || null;

  useEffect(() => {
    const unsub = VidhiEngine.subscribe(setLiveState);
    return () => unsub();
  }, []);

  const maxTicks = liveState?.maxTicks ?? (isFinalRound ? 1000000 : 100000);
  // ─── DYNAMIC METRICS CALCULATION ──────────────────────────────
  const pnlHistory = liveState?.pnlHistory || [];
  const pnlValues = pnlHistory.map(h => h.value);
  
  const calculateMetrics = () => {
    if (pnlValues.length < 2) return { sharpe: '—', drawdown: '—', winRate: '—', alpha: '—', beta: '—' };
    
    // 1. Sharpe Ratio (simplified)
    const returns = [];
    for (let i = 1; i < pnlValues.length; i++) {
      returns.push(pnlValues[i] - pnlValues[i-1]);
    }
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / returns.length) || 1;
    const sharpe = (avgReturn / stdDev * Math.sqrt(252)).toFixed(2);

    // 2. Max Drawdown
    let maxPnl = -Infinity;
    let maxDD = 0;
    pnlValues.forEach(v => {
      if (v > maxPnl) maxPnl = v;
      const dd = maxPnl - v;
      if (dd > maxDD) maxDD = dd;
    });
    const drawdown = ((maxDD / 100000) * 100).toFixed(2) + '%'; // assuming 100k capital

    // 3. Win Rate
    const wins = returns.filter(r => r > 0).length;
    const winRate = ((wins / returns.length) * 100).toFixed(1) + '%';

    // 4. Alpha / Beta (vs simulated benchmark)
    // Beta is currently uncalculable without a benchmark index stream, 
    // but we can proxy alpha as return vs a 0-benchmark.
    const alpha = (avgReturn * 0.1).toFixed(2);
    const beta = '1.00'; // Default to unit beta if no index available

    return { sharpe, drawdown, winRate, alpha, beta };
  };

  const metrics = calculateMetrics();
  const dynSharpe   = metrics.sharpe;
  const dynDrawdown = metrics.drawdown;
  const dynWinRate  = metrics.winRate;
  const dynAlpha    = metrics.alpha;
  const dynBeta     = metrics.beta;

  const botActivity = liveState?.botActivity || {};
  const botKeys = Object.keys(botActivity);
  const totalBotFills = botKeys.reduce((s, k) => s + botActivity[k], 0) || (liveState?.totalFills || 0);
  const botBars = botKeys.length > 0 ? botKeys.map((k, i) => {
     const pct = totalBotFills > 0 ? ((botActivity[k] / totalBotFills) * 100).toFixed(0) : 0;
     const colors = ['var(--accent-blue)', '#FF9500', '#FFD60A', 'var(--accent-green)', '#e11d48'];
     return { label: k.replace('BOT_', '').replace(/_/g, ' '), color: colors[i % colors.length], w: `${pct}%`, pct: `${pct}%` };
  }) : [
     { label: 'Market Maker', color: 'var(--accent-blue)', w: '0%', pct: '0%' },
     { label: 'Momentum', color: '#FF9500', w: '0%', pct: '0%' },
     { label: 'Mean Reversion', color: '#FFD60A', w: '0%', pct: '0%' },
     { label: 'Noise Trader', color: 'var(--accent-green)', w: '0%', pct: '0%' },
     { label: 'Sniper', color: '#e11d48', w: '0%', pct: '0%' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px', gap: '16px', backgroundColor: '#000', overflowY: 'auto' }}>
      
      {/* ─── SECONDARY TAB HEADER (Strategy Backtest etc) ───────── */}
      <div style={{ 
        display: 'flex', alignItems: 'center', backgroundColor: '#0D0F12', 
        padding: '12px 20px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)',
        fontSize: '0.85rem', gap: '24px', flexShrink: 0
      }}>
        {/* Dataset: dropdown */}
        <div style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          Dataset: 
          <span style={{ 
            color: '#fff', backgroundColor: '#1A1D24', padding: '6px 12px', 
            borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.05)'
          }}>
            {isFinalRound
              ? (activeRound?.finalDataKey || 'Production_1M')
              : (activeRound?.testDataKey || 'Public_99k')
            } <ChevronDown size={14} />
          </span>
        </div>
        
        {/* Environment tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Environment:</div>
          <div 
            onClick={() => setIsFinalRound(false)}
            style={{ 
              color: !isFinalRound ? '#fff' : 'var(--text-secondary)', 
              backgroundColor: !isFinalRound ? 'rgba(50, 107, 255, 0.15)' : 'transparent', 
              padding: '6px 16px', 
              borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
              border: !isFinalRound ? '1px solid var(--accent-blue)' : '1px solid transparent',
              transition: 'all 0.2s'
            }}
          >
            Local Backtest (100k)
          </div>
          <div 
            onClick={() => setIsFinalRound(true)}
            style={{ 
              color: isFinalRound ? '#fff' : 'var(--text-secondary)', 
              backgroundColor: isFinalRound ? 'rgba(50, 107, 255, 0.15)' : 'transparent', 
              padding: '6px 16px', 
              borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
              border: isFinalRound ? '1px solid var(--accent-blue)' : '1px solid transparent',
              transition: 'all 0.2s'
            }}
          >
            Final Submission (1M)
          </div>
        </div>

        {/* Search Bar */}
        <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#161920', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '6px 12px', marginLeft: 'auto' }}>
          <Search size={14} color="var(--text-secondary)" style={{ marginRight: '8px' }} />
          <input 
            type="text" 
            placeholder="Filter telemetry..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ backgroundColor: 'transparent', border: 'none', color: '#fff', fontSize: '0.8rem', outline: 'none', width: '160px' }}
          />
        </div>
      </div>

      {/* ─── MAIN 3x3 DASHBOARD GRID ─────────────────────────────────── */}
      <div style={{ 
        display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 1fr', gap: '16px', flex: 1, minHeight: 0 
      }}>

        {/* ─── COLUMN 1: Profile, Scanner, Lamulation ────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* 1. Simulation Status Card */}
          <div className="cc-card" style={{ display: 'flex', flexDirection: 'column', padding: '20px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
            <div className="cc-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: liveState?.done ? '#4ade80' : '#3b82f6', boxShadow: `0 0 8px ${liveState?.done ? '#4ade80' : '#3b82f6'}` }} />
                <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem', letterSpacing: '0.5px' }}>Simulation Status</span>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {commodityName && <span style={{ color: '#fbbf24', fontSize: '0.65rem', backgroundColor: 'rgba(251,191,36,0.1)', padding: '3px 10px', borderRadius: '6px', fontWeight: 700, border: '1px solid rgba(251,191,36,0.2)' }}>{commodityName}</span>}
                <span style={{ color: 'var(--accent-blue)', fontSize: '0.7rem', backgroundColor: 'rgba(29,92,255,0.1)', padding: '3px 10px', borderRadius: '6px', fontWeight: 600, border: '1px solid rgba(29,92,255,0.2)' }}>{isFinalRound ? 'PRODUCTION' : 'TEST CASE'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <div style={{ 
                width: 44, height: 44, borderRadius: '12px', backgroundColor: '#1A1D24', 
                display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.05)'
              }}>
                <Settings2 size={22} color={liveState?.status === 'error' ? '#f87171' : (liveState?.done ? "#4ade80" : "var(--accent-blue)")} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {liveState?.status === 'error' ? 'Simulation Failed' : (liveState?.done ? 'Simulation Complete' : 'Real-time Execution Active')}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '2px' }}>
                  {liveState?.status === 'error' ? 'Code syntax or execution error' : (liveState?.done ? 'Final report ready' : `Processing tick ${liveState?.tick?.toLocaleString() || 0}...`)}
                </div>
              </div>
            </div>
            
            {liveState?.done && (
              <button 
                onClick={() => window.location.href = '/leaderboard'}
                style={{ 
                  marginTop: '16px', backgroundColor: 'var(--accent-blue)', color: '#fff', border: 'none', 
                  padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', 
                  boxShadow: '0 4px 12px rgba(29,92,255,0.3)', transition: 'transform 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'none'}
              >
                View Global Leaderboard
              </button>
            )}
          </div>

          <div className="cc-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
            <div className="cc-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>Bot Fleet Dynamics</span>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', backgroundColor: '#161920', padding: '2px 8px', borderRadius: '4px' }}>LIVE</div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {botBars.map(b => (
                <div key={b.label} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{b.label}</span>
                    <span style={{ color: b.color, fontWeight: 600 }}>{b.pct}</span>
                  </div>
                  <div style={{ backgroundColor: '#161920', height: '8px', borderRadius: '4px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.03)' }}>
                    <div style={{ 
                      width: b.w, backgroundColor: b.color, height: '100%', borderRadius: '4px', 
                      transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: `0 0 10px ${b.color}44`
                    }} />
                  </div>
                </div>
              ))}
            </div>
            
            <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Total Bot Fills</span>
              <span style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600 }}>{totalBotFills.toLocaleString()}</span>
            </div>
          </div>

          <div className="cc-card" style={{ height: '260px', display: 'flex', flexDirection: 'column', padding: '20px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
            <div className="cc-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>Equity Curve (PnL)</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                 <div style={{ width: 12, height: 12, borderRadius: '2px', backgroundColor: 'var(--accent-green)' }} />
              </div>
            </div>
            
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
               <LWChart data={liveState?.pnlHistory} color="#4ade80" height={180} />
            </div>
          </div>
        </div>

        {/* ─── COLUMN 2 ────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div className="cc-card" style={{ padding: '16px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 500 }}>Total Fills</div>
              <div style={{ fontSize: '1.3rem', color: '#fff', fontWeight: 700 }}>{(liveState?.totalFills || 0).toLocaleString()}</div>
            </div>
            <div className="cc-card" style={{ padding: '16px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 500 }}>Net PnL</div>
              <div style={{ fontSize: '1.3rem', color: (liveState?.pnl || 0) >= 0 ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                {(liveState?.pnl || 0) >= 0 ? '+' : ''}${(liveState?.pnl || 0).toFixed(0)}
              </div>
            </div>
            <div className="cc-card" style={{ padding: '16px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 500 }}>Position</div>
              <div style={{ fontSize: '1.3rem', color: '#fff', fontWeight: 700 }}>{liveState?.position || 0}</div>
            </div>
          </div>

          <div style={{ backgroundColor: '#161920', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ width: 48, height: 48, borderRadius: '12px', backgroundColor: 'rgba(50, 107, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(50, 107, 255, 0.2)' }}>
              <ShieldCheck size={24} color="var(--accent-blue)" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: '#fff', fontWeight: 600, fontSize: '1rem' }}>Latency p99</span>
                <span style={{ color: (liveState?.p99 || 0) < 500 ? '#4ade80' : '#fbbf24', fontSize: '1rem', fontWeight: 700 }}>{(liveState?.p99 || 0).toFixed(0)}ns</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                <span>p50: {(liveState?.p50 || 0).toFixed(0)}ns</span>
                <span style={{ color: 'var(--accent-blue)' }}>{((liveState?.p99 || 0) / 100).toFixed(1)}% threshold</span>
              </div>
            </div>
          </div>

          <div className="cc-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', padding: '20px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
            <div className="cc-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <LayoutGrid size={16} color="var(--accent-blue)" />
                <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>LOB Liquidity Depth</span>
              </div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem' }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: 8, height: 8, borderRadius: '2px', backgroundColor: '#e11d48' }} /> ASK</div>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: 8, height: 8, borderRadius: '2px', backgroundColor: 'var(--accent-green)' }} /> BID</div>
              </div>
            </div>
            
            <div style={{ 
              position: 'absolute', right: 20, top: 56, backgroundColor: 'rgba(22, 25, 32, 0.8)', 
              backdropFilter: 'blur(4px)', border: '1px solid rgba(255,255,255,0.08)', padding: '10px 14px', borderRadius: '8px', zIndex: 10, 
              display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' 
            }}>
              <div style={{ color: '#fff', display: 'flex', justifyContent: 'space-between', gap: '12px' }}><span>p50</span> <span style={{ color: 'var(--accent-blue)' }}>{(liveState?.p50 || 0).toFixed(0)}ns</span></div>
              <div style={{ color: '#fff', display: 'flex', justifyContent: 'space-between', gap: '12px' }}><span>p99</span> <span style={{ color: 'var(--accent-blue)' }}>{(liveState?.p99 || 0).toFixed(0)}ns</span></div>
              <div style={{ color: 'var(--accent-green)', marginTop: '4px', paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>Correctness {liveState?.correctness !== undefined ? (liveState.correctness * 100).toFixed(2) + '%' : '100%'}</div>
            </div>

            <div style={{ flex: 1, position: 'relative', marginTop: '12px', minHeight: 0 }}>
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '100%', display: 'flex', alignItems: 'flex-end', gap: '6px', padding: '0 10px' }}>
                {/* Dynamically render order book depth bars from backend telemetry */}
                {(() => {
                  const bids = liveState?.bidDepth || [];
                  const asks = liveState?.askDepth || [];
                  const combined = [...bids.slice().reverse(), ...asks];
                  if (combined.length === 0) {
                    // Fallback visual if no depth data yet
                    return Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} style={{ flex: 1, height: `${20 + Math.random() * 40}%`, backgroundColor: i < 5 ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)', borderRadius: '2px 2px 0 0' }} />
                    ));
                  }
                  return combined.map((level, i) => {
                    const maxVol = 600;
                    const height = Math.min((level.volume / maxVol) * 100, 100);
                    const isBid = i < bids.length;
                    return (
                      <div 
                        key={i} 
                        style={{ 
                          flex: 1, 
                          height: `${Math.max(height, 5)}%`, 
                          backgroundColor: isBid ? '#4ade80' : '#f87171', 
                          opacity: 0.85, 
                          borderRadius: '2px 2px 0 0', 
                          transformOrigin: 'bottom', 
                          transition: 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)', 
                          animation: `growUp 0.3s ease-out backwards` 
                        }} 
                      />
                    );
                  });
                })()}
              </div>
            </div>
          </div>

          <div className="cc-card" style={{ height: '200px', display: 'flex', flexDirection: 'column', padding: '20px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
            <div className="cc-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>Latency Profile</span>
              <BadgeCheck size={16} color="var(--accent-blue)" />
            </div>
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
               <LWChart data={liveState?.latencyHistory} color="#fbbf24" height={140} title="p50 Latency (ns)" />
            </div>
          </div>
        </div>

        {/* ─── COLUMN 3 ────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          <div className="cc-card" style={{ display: 'flex', flexDirection: 'column', padding: '20px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
            <div className="cc-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>Market Volume</span>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: '#1A1D24', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <User size={16} color="var(--accent-blue)" />
                </div>
                <div>
                  <div style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600 }}>Main Node</div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>Core 2/3 Isolated</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600 }}>{liveState?.totalFills?.toLocaleString() || 0}</div>
                {(() => {
                  const vh = liveState?.volumeHistory || [];
                  if (vh.length < 2) return null;
                  const prev = vh[vh.length - 2]?.value || 0;
                  const curr = vh[vh.length - 1]?.value || 0;
                  const pct  = prev > 0 ? ((curr - prev) / prev * 100).toFixed(1) : '0.0';
                  const color = parseFloat(pct) >= 0 ? 'var(--accent-green)' : '#f87171';
                  return <div style={{ color, fontSize: '0.7rem' }}>{parseFloat(pct) >= 0 ? '+' : ''}{pct}%</div>;
                })()}
              </div>
            </div>

            <div style={{ height: '90px', position: 'relative', minHeight: 0 }}>
              <LWChart data={liveState?.volumeHistory} color="#a855f7" height={90} priceFormat="volume" />
            </div>
          </div>

          <div className="cc-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
            <div className="cc-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>Fill Distribution</span>
              <MoreHorizontal size={16} color="var(--text-secondary)" cursor="pointer" />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {(() => {
                const total = Object.values(botActivity).reduce((a, b) => a + b, 0) || 1;
                const aggressiveTakerCount = (botActivity.BOT_MOMENTUM || 0) + (botActivity.BOT_SNIPER || 0);
                const passiveMakerCount    = (botActivity.BOT_MARKET_MAKER || 0) + (botActivity.BOT_MEAN_REVERSION || 0);
                const noiseCount           = (botActivity.BOT_NOISE || 0);
                const fillRows = [
                  { label: 'Aggressive Taker', val: `${((aggressiveTakerCount / total) * 100).toFixed(1)}%`, color: '#f87171' },
                  { label: 'Passive Maker',    val: `${((passiveMakerCount    / total) * 100).toFixed(1)}%`, color: '#4ade80' },
                  { label: 'Noise / Random',   val: `${((noiseCount           / total) * 100).toFixed(1)}%`, color: '#60a5fa' },
                ];
                return fillRows;
              })().map((r, i) => (
                <div 
                  key={i} 
                  style={{ 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#161920', 
                    padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem', 
                    border: '1px solid rgba(255,255,255,0.03)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: r.color }} />
                    <span style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
                  </div>
                  <span style={{ color: '#fff', fontWeight: 600 }}>{r.val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Algorithm Metrics list */}
          <div className="cc-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
            <div className="cc-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>Algorithm Risk Metrics</span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <MetricCard label="Sharpe Ratio" value={dynSharpe} />
              <MetricCard label="Max Drawdown" value={dynDrawdown} color="#f87171" />
              <MetricCard label="Win Rate" value={dynWinRate} />
              <MetricCard label="Alpha (vs MM)" value={dynAlpha} color="#4ade80" />
              <MetricCard label="Beta (Market)" value={dynBeta} />
            </div>
          </div>

        </div>
      </div>
      
      {/* Global CSS for animations */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes growUp {
          from { transform: scaleY(0); }
          to { transform: scaleY(1); }
        }
        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 0.3; }
          100% { opacity: 0.6; }
        }
      `}} />
    </div>
  );
}
