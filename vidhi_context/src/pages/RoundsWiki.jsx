import React from 'react';
import { BookOpen, Zap, ShieldAlert, Cpu } from 'lucide-react';

export default function RoundsWiki() {
  return (
    <div style={{ padding: '32px', color: 'var(--text-bright)', maxWidth: '900px', margin: '0 auto', overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
        <BookOpen size={32} color="var(--accent-blue)" />
        <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 600 }}>Tournament Wiki</h1>
      </div>

      <div style={{ display: 'grid', gap: '24px' }}>
        <div className="cc-card" style={{ padding: '24px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.2rem', marginTop: 0, color: 'var(--accent-blue)' }}>
            <Zap size={20} /> Platform Mechanics
          </h2>
          <p style={{ lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            Vidhi Arena simulates a limit order book (LOB) matching engine. Your algorithm will receive a <code>state</code> object containing the current market state and an <code>orders</code> object to submit market orders.
            The backend execution is compiled via Numba to C++ and runs with nanosecond-level latency precision.
          </p>
        </div>

        <div className="cc-card" style={{ padding: '24px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.2rem', marginTop: 0, color: 'var(--accent-green)' }}>
            <ShieldAlert size={20} /> Current Round: Round 1 (Qualifiers)
          </h2>
          <p style={{ lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            <strong>Goal:</strong> Achieve a positive PnL against the baseline noise traders.<br/><br/>
            <strong>Market Conditions:</strong> The market follows a Geometric Brownian Motion (GBM) with mean reversion. <br/>
            <strong>Dataset:</strong> The public evaluation runs on 100,000 ticks. The final evaluation will run on 1,000,000 unseen ticks.<br/>
            <strong>Position Limits:</strong> Maximum absolute position is 1000 contracts.
          </p>
        </div>

        <div className="cc-card" style={{ padding: '24px', backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.2rem', marginTop: 0, color: '#f59e0b' }}>
            <Cpu size={20} /> Upcoming: Round 2 (Adversarial LOB)
          </h2>
          <p style={{ lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            <strong>Status:</strong> Locked.<br/><br/>
            In Round 2, you will be competing against active market makers. You must manage inventory risk and avoid toxic flow. Limit orders will be unlocked in your API.
          </p>
        </div>
      </div>
    </div>
  );
}
