import React, { useState } from 'react';
import { Database, Bot, Layers, Shield, ChevronDown, ChevronUp, TrendingUp, TrendingDown } from 'lucide-react';

const ASSET = {
  symbol: 'VIDHI-1',
  type: 'Synthetic Equity',
  basePrice: '$1,500.00',
  tickSize: '$0.01',
  maxPosition: '±1,000 units',
  startingCapital: '$100,000',
  ticks: '100,000 (public) / 1,000,000 (final)',
  fees: 'No maker/taker fees in public phase',
  description: 'A single synthetic equity driven by a Geometric Brownian Motion price signal with mean reversion toward $1,500. Volatility spikes every 10,000 ticks simulating news events.',
};

const BOTS = [
  {
    id: 'BOT_MM',
    name: 'Market Maker',
    color: '#00d4ff',
    strategy: 'Avellaneda-Stoikov Quote Skewing',
    desc: 'Always maintains bid/ask quotes around fair value. Adjusts quote width based on realized volatility and inventory buildup. If you consistently take liquidity, the Market Maker widens its spread — you pay more each trade.',
    howToCounter: 'Use limit orders to earn the spread instead of crossing it. Avoid large market orders that telegraph your direction.',
    threat: 'HIGH',
    fills_pct: '~35% of all fills',
  },
  {
    id: 'BOT_MOM',
    name: 'Momentum Trader',
    color: '#a855f7',
    strategy: 'EMA Crossover + Aggressive Market Orders',
    desc: 'Tracks a fast and slow EMA of mid-price. When the fast EMA diverges above the slow EMA by 3+ ticks, it fires market buys. If your aggressive buying causes a price spike, Momentum piles in — amplifying the move against you.',
    howToCounter: 'Execute orders in smaller slices. Avoid pushing price too far in one tick — Momentum will front-run the continuation.',
    threat: 'MEDIUM',
    fills_pct: '~20% of all fills',
  },
  {
    id: 'BOT_MR',
    name: 'Mean Reversion',
    color: '#f59e0b',
    strategy: 'Fair Value Fade with Large Limit Orders',
    desc: 'Calculates fair value from the underlying price signal. When price deviates 5+ ticks, it places large limit orders fading the move. Your aggressive directional bets will be absorbed by Mean Reversion supply/demand walls.',
    howToCounter: 'Don\'t overextend. Acknowledge that price has a gravitational pull toward fair value. Mean Rev is your biggest enemy when momentum trading.',
    threat: 'HIGH',
    fills_pct: '~25% of all fills',
  },
  {
    id: 'BOT_NOISE',
    name: 'Noise Trader',
    color: '#6b7280',
    strategy: 'Randomized Limit Order Spray',
    desc: 'Fires random-sized limit orders near the best bid/ask every ~40% of ticks. Creates realistic background order flow and occasionally fills your resting limit orders unpredictably. Simulates retail order flow.',
    howToCounter: 'Good news: Noise Trader fills your limit orders for free. Bad news: it occasionally fills them at the wrong time. Size your limits accordingly.',
    threat: 'LOW',
    fills_pct: '~10% of all fills',
  },
  {
    id: 'BOT_SNIPER',
    name: 'Sniper / Arbitrageur',
    color: '#e11d48',
    strategy: 'Fair Value Arbitrage — Instant Execution',
    desc: 'Monitors the gap between best bid/ask and the underlying fair value signal. When mispricing exceeds 1 tick, it immediately sweeps the stale quotes. Ensures no free money is left in the book. Your aggressive orders cannot move price far from fair value.',
    howToCounter: 'You cannot beat Sniper on stale quotes. Focus on predicting where fair value is GOING, not where it IS.',
    threat: 'MEDIUM',
    fills_pct: '~10% of all fills',
  },
];

const THREAT_COLORS = { HIGH: '#e11d48', MEDIUM: '#f59e0b', LOW: '#10b981' };

function BotCard({ bot }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ backgroundColor: 'var(--panel-bg)', border: `1px solid ${expanded ? bot.color + '40' : 'var(--border-glass)'}`,
      transition: 'border-color 0.2s', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px',
        cursor: 'pointer' }} onClick={() => setExpanded(e => !e)}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: bot.color,
          boxShadow: `0 0 8px ${bot.color}80`, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: 'var(--text-bright)', fontFamily: "'Roboto Mono', monospace",
              fontSize: '0.85rem', fontWeight: 700 }}>{bot.name}</span>
            <span style={{ fontSize: '0.6rem', color: THREAT_COLORS[bot.threat],
              border: `1px solid ${THREAT_COLORS[bot.threat]}60`, padding: '1px 6px',
              fontFamily: "'Roboto Mono', monospace" }}>THREAT: {bot.threat}</span>
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem',
            fontFamily: "'Roboto Mono', monospace", marginTop: '3px' }}>{bot.strategy}</div>
        </div>
        <div style={{ color: '#555', fontSize: '0.7rem', fontFamily: "'Roboto Mono', monospace",
          marginRight: '8px' }}>{bot.fills_pct}</div>
        {expanded ? <ChevronUp size={14} color="#555" /> : <ChevronDown size={14} color="#555" />}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '0 20px 16px 44px', display: 'flex', flexDirection: 'column', gap: '12px',
          borderTop: '1px solid var(--border-glass)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.7, margin: '12px 0 0 0' }}>
            {bot.desc}
          </p>
          <div style={{ backgroundColor: '#050505', border: '1px solid #1a1a1a', padding: '12px' }}>
            <div style={{ color: '#10b981', fontSize: '0.65rem', fontFamily: "'Roboto Mono', monospace",
              letterSpacing: '1px', marginBottom: '6px' }}>▶ HOW TO COUNTER</div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.6, margin: 0 }}>
              {bot.howToCounter}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AssetWiki() {
  return (
    <div style={{ padding: '1.5rem', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Database size={18} color="var(--text-bright)" />
        <span style={{ color: 'var(--text-bright)', fontFamily: "'Roboto Mono', monospace",
          fontSize: '0.85rem', letterSpacing: '2px' }}>COMPETITION RULES & ASSET WIKI</span>
      </div>

      {/* ── Asset spec card ─────────────────────────────────────────── */}
      <div style={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--border-glass)', padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <Layers size={14} color="#a855f7" />
          <span style={{ color: 'var(--text-bright)', fontFamily: "'Roboto Mono', monospace",
            fontSize: '0.8rem', letterSpacing: '2px' }}>{ASSET.symbol}</span>
          <span style={{ color: '#555', fontFamily: "'Roboto Mono', monospace", fontSize: '0.65rem' }}>
            {ASSET.type}
          </span>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.7, margin: '0 0 16px 0' }}>
          {ASSET.description}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', backgroundColor: 'var(--border-glass)' }}>
          {[
            ['Base Price',        ASSET.basePrice],
            ['Tick Size',         ASSET.tickSize],
            ['Max Position',      ASSET.maxPosition],
            ['Starting Capital',  ASSET.startingCapital],
            ['Tick Count',        ASSET.ticks],
            ['Fees',              ASSET.fees],
          ].map(([k, v]) => (
            <div key={k} style={{ backgroundColor: '#050505', padding: '12px 14px' }}>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)',
                fontFamily: "'Roboto Mono', monospace", letterSpacing: '1px', marginBottom: '4px' }}>{k}</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-bright)',
                fontFamily: "'Roboto Mono', monospace" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Scoring section ─────────────────────────────────────────── */}
      <div style={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--border-glass)', padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <Shield size={14} color="#a855f7" />
          <span style={{ color: 'var(--text-bright)', fontFamily: "'Roboto Mono', monospace",
            fontSize: '0.75rem', letterSpacing: '1.5px' }}>SCORING MODEL</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {[
            { label: 'Primary', desc: 'Final PnL% = (cash + position × last_price − capital) / capital × 100' },
            { label: 'Tiebreaker', desc: 'Average ns/tick latency — lower wins when PnL is within 0.001%' },
            { label: 'Position Breach', desc: 'Position > ±1,000 units → −10% PnL penalty per violation' },
            { label: 'TLE Tick', desc: 'Timeout >100µs on final run → order treated as HOLD, tick counted' },
          ].map(s => (
            <div key={s.label} style={{ backgroundColor: '#050505', padding: '12px' }}>
              <div style={{ color: '#a855f7', fontFamily: "'Roboto Mono', monospace",
                fontSize: '0.65rem', letterSpacing: '1px', marginBottom: '6px' }}>{s.label.toUpperCase()}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.5 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bot roster ──────────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <Bot size={14} color="var(--text-dim)" />
          <span style={{ color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace",
            fontSize: '0.65rem', letterSpacing: '1.5px' }}>YOUR OPPONENTS — CLICK TO EXPAND</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          {BOTS.map(b => <BotCard key={b.id} bot={b} />)}
        </div>
      </div>

      {/* ── Two-phase explanation ────────────────────────────────────── */}
      <div style={{ backgroundColor: '#050505', border: '1px solid #1a1a1a', padding: '16px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div>
            <div style={{ color: '#00d4ff', fontFamily: "'Roboto Mono', monospace",
              fontSize: '0.65rem', letterSpacing: '1px', marginBottom: '8px' }}>PHASE 1 — BROWSER (NOW)</div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem', lineHeight: 1.6 }}>
              100,000 public ticks. Unlimited runs. All 5 bots present. Same bot strategies, JS simulation engine. Tune your strategy here.
            </div>
          </div>
          <div>
            <div style={{ color: '#a855f7', fontFamily: "'Roboto Mono', monospace",
              fontSize: '0.65rem', letterSpacing: '1px', marginBottom: '8px' }}>PHASE 2 — FINAL CRUCIBLE (CLOUD)</div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem', lineHeight: 1.6 }}>
              1,000,000 hidden ticks. 5 runs/day. Compiled to native .so on bare-metal EPYC. Same 5 bots. Your last submitted code is your final entry.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
