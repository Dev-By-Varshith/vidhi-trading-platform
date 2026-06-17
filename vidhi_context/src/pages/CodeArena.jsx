import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { useNavigate } from 'react-router-dom';
import { X, CheckCircle2, Loader2, ShieldCheck, Cpu, Code2 } from 'lucide-react';
import VidhiEngine from '../engine/VidhiEngine';
import ContestStore from '../store/ContestStore';

const DEFAULT_CODE = `def on_tick(state, orders):
    """
    A simple algorithmic trading strategy
    Evaluates market mispricings against the underlying signal.
    """
    # Buy when the market is under-pricing the asset
    if state.mid_price < state.underlying_signal - 0.5:
        if state.position < 100:
            orders.market_buy(10)
            
    # Sell when the market is over-pricing the asset
    elif state.mid_price > state.underlying_signal + 0.5:
        if state.position > -100:
            orders.market_sell(10)
`;

function ValidationModal({ status, onCancel }) {
  const [times, setTimes] = useState({ scanning: 0, transpiling: 0, compiling: 0, validating: 0 });
  const [startTimes, setStartTimes] = useState({});

  useEffect(() => {
    const timer = setInterval(() => {
      setTimes(prev => {
        const next = { ...prev };
        const now = Date.now();
        if (status === 'scanning') next.scanning = now - (startTimes.scanning || now);
        if (status === 'transpiling') next.transpiling = now - (startTimes.transpiling || now);
        if (status === 'compiling') next.compiling = now - (startTimes.compiling || now);
        if (status === 'validating') next.validating = now - (startTimes.validating || now);
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [status, startTimes]);

  useEffect(() => {
    if (status && !startTimes[status]) {
      setStartTimes(prev => ({ ...prev, [status]: Date.now() }));
    }
  }, [status]);

  const steps = [
    { id: 'scanning', label: 'AST Scanner' },
    { id: 'transpiling', label: 'Numba Compilation' },
    { id: 'compiling', label: 'Compiling...' },
    { id: 'validating', label: 'ELF Validator' },
  ];

  const getStepStatus = (stepId) => {
    const order = ['queued', 'scanning', 'transpiling', 'compiling', 'validating', 'queued_gm', 'running', 'done'];
    const currentIdx = order.indexOf(status);
    const stepIdx = order.indexOf(stepId);

    if (currentIdx > stepIdx) return 'completed';
    if (currentIdx === stepIdx) return 'active';
    return 'pending';
  };

  const formatTime = (ms) => {
    if (ms < 1000) return `${Math.max(ms, 40)}ms`;
    return `${(ms / 1000).toFixed(1)} seconds`;
  };

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        width: '400px', backgroundColor: '#1A1D24', borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.05)', padding: '20px 24px',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: '24px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem', fontWeight: 600 }}>Validater Validations</h3>
          <X size={18} color="var(--text-secondary)" cursor="pointer" onClick={onCancel} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {steps.map(step => {
            const s = getStepStatus(step.id);
            const isActive = s === 'active';
            const isDone = s === 'completed';

            let bgColor = 'rgba(255,255,255,0.02)';
            let borderColor = 'rgba(255,255,255,0.05)';
            let mainColor = 'var(--text-secondary)';

            if (isDone) {
              bgColor = 'rgba(74, 222, 128, 0.08)';
              mainColor = '#4ade80';
            } else if (isActive) {
              bgColor = 'rgba(251, 191, 36, 0.08)';
              mainColor = '#fbbf24';
            }

            return (
              <div key={step.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', borderRadius: '8px',
                backgroundColor: bgColor,
                transition: 'all 0.3s'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ color: mainColor, display: 'flex' }}>
                    {isDone ? <CheckCircle2 size={18} /> : isActive ? <Loader2 size={18} className="spin" /> : <div style={{ width: 18 }} />}
                  </div>
                  <span style={{ color: isDone || isActive ? '#fff' : 'var(--text-secondary)', fontWeight: 500, fontSize: '0.9rem' }}>
                    {step.label}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: mainColor }}>
                  {isDone ? (
                    <>
                      <CheckCircle2 size={16} />
                      <span>{formatTime(times[step.id] || 150)}</span>
                    </>
                  ) : isActive ? (
                    <span>Compiling...</span>
                  ) : (
                    <span>Waiting...</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4px' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 16px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)',
              backgroundColor: 'transparent', color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            Derailment
          </button>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{
        __html: `
        .spin { animation: spin 2s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}

export default function CodeArena() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [simStatus, setSimStatus] = useState('idle');
  const [showModal, setShowModal] = useState(false);
  const hasNavigatedRef = useRef(false);
  const startTimeRef = useRef(0);
  const navigate = useNavigate();

  useEffect(() => {
    const unsub = VidhiEngine.onStatus((status) => {
      setSimStatus(status);

      if (['queued', 'scanning', 'transpiling', 'compiling', 'validating'].includes(status)) {
        if (!startTimeRef.current) startTimeRef.current = Date.now();
        setShowModal(true);
      }

      if ((status === 'running' || status === 'queued_gm') && !hasNavigatedRef.current) {
        // Transition to dashboard once compilation is successful, minimum 3s animation view
        hasNavigatedRef.current = true;
        const elapsed = Date.now() - (startTimeRef.current || Date.now());
        const delay = Math.max(2000 - elapsed, 500);

        setTimeout(() => {
          setShowModal(false);
          startTimeRef.current = 0;
          navigate('/simulation');
        }, delay);
      }

      if (status === 'error' || status === 'tle') {
        const runId = VidhiEngine.instance?.currentRunId;
        if (runId) {
            console.log("Failed run ID:", runId);
            fetch(`/api/runs/${runId}/execution-log`).then(r => r.text()).then(t => console.error("EXECUTION LOG FROM AWS:", t));
        }
        const errorMsg = VidhiEngine.instance?.lastState?.errorMessage || VidhiEngine.instance?.lastState?.error || VidhiEngine.instance?.logHistory[VidhiEngine.instance.logHistory.length - 1]?.msg || 'Compilation or Engine Error';
        alert('Simulation Error:\n\n' + errorMsg + '\n\nCheck browser console for more details.');
        hasNavigatedRef.current = false;
        setShowModal(false);
        startTimeRef.current = 0;
      }

      if (status === 'idle' || status === 'done') {
        hasNavigatedRef.current = false;
        setShowModal(false);
        startTimeRef.current = 0;
      }
    });
    return () => unsub();
  }, [navigate]);

  const handleRunLocal = async () => {
    ContestStore.saveLastCode(code);
    const options = { maxTicks: 100_000, isFinal: false };
    await VidhiEngine.startSimulation(code, options);
  };

  const handleSubmitCloud = async () => {
    ContestStore.saveLastCode(code);
    const options = { maxTicks: 1_000_000, isFinal: true };
    await VidhiEngine.startSimulation(code, options);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', backgroundColor: '#000' }}>

      {showModal && <ValidationModal status={simStatus} onCancel={() => VidhiEngine.stopSimulation()} />}

      {/* ─── EDITOR CARD CONTAINER ───────────────────────────────────── */}
      <div className="cc-card" style={{
        flex: 1, display: 'flex', flexDirection: 'column', padding: '0',
        backgroundColor: '#0D0F12', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px'
      }}>
        {/* Editor tab bar */}
        <div style={{
          display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)',
          backgroundColor: '#0D0F12', borderTopLeftRadius: '8px', borderTopRightRadius: '8px'
        }}>
          {/* Base Strategy tab (inactive) */}
          <div style={{
            padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '8px',
            color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer',
            borderRight: '1px solid rgba(255,255,255,0.03)'
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#3776AB' }} />
            Base Strategy
          </div>
          {/* Moving Average tab (active) */}
          <div style={{
            padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '8px',
            color: '#fff', backgroundColor: '#161920', borderTop: '2px solid var(--accent-blue)',
            fontSize: '0.8rem', borderRight: '1px solid rgba(255,255,255,0.05)'
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'linear-gradient(45deg, #FFD700, #FFA500)' }} />
            Moving Average
            <X size={12} style={{ cursor: 'pointer', marginLeft: '6px' }} />
          </div>
        </div>

        {/* Monaco Editor area */}
        <div style={{ flex: 1, minHeight: 0, backgroundColor: '#161920' }}>
          <Editor
            height="100%"
            defaultLanguage="python"
            theme="vs-dark"
            value={code}
            onChange={val => setCode(val || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'Roboto Mono', monospace",
              padding: { top: 16 },
              scrollBeyondLastLine: false,
              renderLineHighlight: 'none',
              lineHeight: 20,
              colors: {
                'editor.background': '#161920'
              }
            }}
          />
        </div>

        {/* Bottom controls panel */}
        <div style={{
          padding: '16px 24px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)',
          backgroundColor: '#0D0F12', borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
              Credits Remaining: <span style={{ color: 'var(--accent-green)' }}>5/5</span>
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', cursor: 'pointer', textDecoration: 'underline' }}>
              View Strategy Compilation Logs
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
              Backend persistent fields: `state.ema_fast`, `state.ema_slow`, `state.tick_count`, `state.s0..state.s7`
            </span>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleRunLocal}
              style={{
                backgroundColor: 'transparent', color: '#fff', border: '1px solid #2D3342',
                borderRadius: '6px', padding: '10px 24px', fontSize: '0.9rem',
                fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              Run Test Case (Local)
            </button>
            <button
              onClick={handleSubmitCloud}
              style={{
                backgroundColor: '#326BFF', color: '#fff', border: 'none',
                borderRadius: '6px', padding: '10px 32px', fontSize: '0.9rem',
                fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 12px rgba(50, 107, 255, 0.3)',
                transition: 'all 0.2s'
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#1D5CFF'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = '#326BFF'}
            >
              Submit Strategy (Cloud)
            </button>
          </div>
        </div>
      </div>



      {/* CSS transitions */}
      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}} />
    </div>
  );
}
