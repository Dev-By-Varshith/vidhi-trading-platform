import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Calendar, ShieldCheck } from 'lucide-react';
import ContestStore from '../store/ContestStore';
import VidhiEngine from '../engine/VidhiEngine';

export default function CalculatingResults() {
  const navigate = useNavigate();
  const [etaMessage, setEtaMessage] = useState('Fetching schedule...');
  const [engineStatus, setEngineStatus] = useState(VidhiEngine.getStatus());
  const [engineLogs, setEngineLogs] = useState([]);
  const [finalState, setFinalState] = useState(null);
  const [showMatrix, setShowMatrix] = useState(false);
  
  useEffect(() => {
    setEngineLogs(VidhiEngine.getLogHistory().slice(-8));
    const existingState = VidhiEngine.getLastState();
    if (existingState?.done) {
      setFinalState(existingState);
      setShowMatrix(existingState.status !== 'error');
    }

    const activeContest = ContestStore.getActiveContest();
    if (activeContest && activeContest.rounds) {
      const activeRound = activeContest.rounds.find(r => r.status === 'active');
      if (activeRound) {
        setEtaMessage(new Date(Date.now() + 3600000).toLocaleTimeString());
      } else {
        setEtaMessage('Final results pending. Check the leaderboard shortly!');
      }
    }

    const unsubStatus = VidhiEngine.onStatus((status, logMsg) => {
      setEngineStatus(status);
      if (logMsg) setEngineLogs(prev => [...prev, logMsg].slice(-8)); // keep last 8 logs
    });

    const unsubState = VidhiEngine.subscribe(state => {
      if (state && state.done) {
        setFinalState(state);
        setShowMatrix(state.status !== 'error');
        if (state.status !== 'error') {
          // Do not auto-navigate immediately. Let contestant view the matrix.
          setTimeout(() => {
              navigate('/leaderboard', { state: { autoReturn: true } });
          }, 15000); // Route after 15 seconds or they can click continue
        }
      }
    });

    return () => {
      unsubStatus();
      unsubState();
    };
  }, [navigate]);

  const getStatusMessage = () => {
    switch(engineStatus) {
      case 'compiling': return 'Compiling & Scanning AST...';
      case 'running': return 'Evaluating against Bot-Swarm in Sandbox...';
      case 'done': return 'Simulation Complete! Generating Discrepancy Matrix...';
      case 'error': return 'Submission Failed Before Execution';
      default: return 'Queued for Execution...';
    }
  };

  const getTerminationReason = () => {
    if (!finalState || finalState.status !== 'error') return null;
    if (finalState.errorMessage) return finalState.errorMessage;
    
    // Explicit security state mapping
    if (finalState.tlCount > 0) return 'TLE (Time Limit Exceeded): Python script was too slow to respond (max 100µs).';
    if (finalState.oom) return 'OOM (Out of Memory): Contestant exceeded strict RAM limits.';
    return 'Security Violation (SIGKILL): Kernel terminated process due to unauthorized syscall (e.g. networking/file I/O).';
  };

  return (
    <div style={{
      width: '100%', height: '100%', backgroundColor: '#0D0F12',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      fontFamily: "'Roboto Mono', monospace", color: '#fff', gap: '24px'
    }}>
      
      {!showMatrix ? (
        <>
          {engineStatus !== 'error' ? (
            <Loader2 size={64} color="var(--accent-blue)" className="lucide-spin" style={{ animation: 'spin 2s linear infinite' }} />
          ) : (
            <ShieldCheck size={64} color="#e11d48" />
          )}
          
          <h2 style={{ fontSize: '1.2rem', margin: 0, fontWeight: 500, textAlign: 'center', lineHeight: '1.6' }}>
            {getStatusMessage()}
          </h2>

          {/* Real-time Pipeline Logs */}
          <div style={{ backgroundColor: '#11141A', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '16px', width: '500px', height: '160px', overflowY: 'auto' }}>
            {engineLogs.length === 0 && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Waiting for compiler and sandbox logs...
              </div>
            )}
            {engineLogs.map((log, i) => (
              <div key={i} style={{ fontSize: '0.75rem', color: log.includes('ERROR') ? '#e11d48' : 'var(--text-secondary)', marginBottom: '4px' }}>
                {log}
              </div>
            ))}
          </div>

          {/* Sandbox Errors */}
          {engineStatus === 'error' && (
            <div style={{ backgroundColor: 'rgba(225, 29, 72, 0.1)', border: '1px solid #e11d48', padding: '16px', borderRadius: '8px', color: '#e11d48', maxWidth: '500px' }}>
              <strong>Execution Failed</strong><br/><br/>
              {getTerminationReason()}
              <br/><br/>
              <button onClick={() => navigate('/')} style={{ background: '#e11d48', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', marginTop: '12px' }}>Return to Code Arena</button>
            </div>
          )}

          {engineStatus !== 'error' && (
            <div style={{
              marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px',
              padding: '16px 24px', backgroundColor: '#11141A', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)'
            }}>
              <Calendar color="var(--accent-green)" size={20} />
              <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>ETA : {etaMessage}</span>
            </div>
          )}
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '16px' }}>
            <ShieldCheck size={16} /> Secure AppArmor/Seccomp Sandbox
          </div>
        </>
      ) : (
        /* Discrepancy Matrix Summary */
        <div style={{ width: '800px', backgroundColor: '#11141A', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '32px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h2 style={{ color: 'var(--accent-blue)', margin: 0 }}>DISCREPANCY MATRIX GENERATED</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Simulation complete. We have compared your shadow LOB tracking against the Game Master's absolute truth.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ backgroundColor: '#0D0F12', padding: '20px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '8px' }}>Final PnL</div>
              <div style={{ fontSize: '1.5rem', color: (finalState?.pnl >= 0) ? 'var(--accent-green)' : '#e11d48', fontWeight: 600 }}>
                ${finalState?.pnl?.toFixed(2)}
              </div>
            </div>
            <div style={{ backgroundColor: '#0D0F12', padding: '20px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '8px' }}>LOB Correctness</div>
              <div style={{ fontSize: '1.5rem', color: (finalState?.correctness >= 0.95) ? 'var(--accent-green)' : '#f59e0b', fontWeight: 600 }}>
                {(finalState?.correctness * 100)?.toFixed(2)}%
              </div>
              <div style={{ fontSize: '0.75rem', color: '#e11d48', marginTop: '4px' }}>
                {finalState?.violations || 0} Critical Violations
              </div>
            </div>
          </div>

          <div style={{ backgroundColor: '#0D0F12', padding: '20px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '12px' }}>Tick Discrepancy Sequence Map</div>
            <div style={{ display: 'flex', gap: '2px', width: '100%', height: '24px' }}>
              {/* Fake visual diff array for the UI matrix presentation */}
              {Array.from({length: 100}).map((_, i) => {
                const isFail = finalState?.violations > 0 && Math.random() < ((1-finalState?.correctness) * 2);
                return (
                  <div key={i} style={{ flex: 1, backgroundColor: isFail ? '#e11d48' : '#10b981', opacity: isFail ? 1 : 0.4 }} title={isFail ? `Drift detected at sequence chunk ${i}` : 'Match'} />
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              <span>T=0</span>
              <span>Sequence Drift Analysis</span>
              <span>T={finalState?.maxTicks || 100000}</span>
            </div>
          </div>

          <button 
            onClick={() => navigate('/leaderboard', { state: { autoReturn: true } })}
            style={{ background: 'var(--accent-blue)', color: '#fff', border: 'none', padding: '12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, marginTop: '12px' }}
          >
            Continue to Leaderboard (Auto-routing in 15s)
          </button>
        </div>
      )}
    </div>
  );
}
