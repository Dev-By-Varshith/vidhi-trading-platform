import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import CodeArena from './pages/CodeArena';
import SimulationDashboard from './pages/SimulationDashboard';
import Leaderboard from './pages/Leaderboard';
import AssetWiki from './pages/AssetWiki';
import Submissions from './pages/Submissions';
import RoleSelector from './pages/RoleSelector';
import ContestLobby from './pages/ContestLobby';
import ContestCreator from './pages/ContestCreator';
import CalculatingResults from './pages/CalculatingResults';
import RoundsWiki from './pages/RoundsWiki';
import ContestStore from './store/ContestStore';

// ─── Route guard ──────────────────────────────────────────────────────────────
// Forces role selection if user hasn't picked a role yet.
function RoleGuard({ children, requiredRole }) {
  const [storeState, setStoreState] = useState(ContestStore.state);
  useEffect(() => ContestStore.subscribe(s => setStoreState({ ...s })), []);

  const role = storeState.role;
  if (!role) return <Navigate to="/select-role" replace />;
  if (requiredRole && role !== requiredRole) return <Navigate to="/select-role" replace />;
  return children;
}

import { AlertCircle } from 'lucide-react';

function PlaceholderPage({ title, icon: Icon = AlertCircle }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
      <Icon size={48} strokeWidth={1} style={{ marginBottom: '16px', color: 'var(--accent-blue)', opacity: 0.8 }} />
      <h2 style={{ margin: '0 0 8px 0', color: '#fff', fontSize: '1.2rem', fontFamily: "'Roboto Mono', monospace" }}>{title}</h2>
      <p style={{ margin: 0, fontSize: '0.85rem' }}>This module is currently under development.</p>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Landing: role selector (no guard) */}
        <Route path="/select-role" element={<RoleSelector />} />

        {/* Creator-only */}
        <Route path="/creator" element={
          <RoleGuard requiredRole="creator">
            <ContestCreator />
          </RoleGuard>
        } />

        {/* Student lobby (no layout — full-screen) */}
        <Route path="/lobby" element={
          <RoleGuard requiredRole="student">
            <ContestLobby />
          </RoleGuard>
        } />

        {/* Student arena — requires student role + active contest */}
        <Route path="/" element={
          <RoleGuard requiredRole="student">
            <Layout />
          </RoleGuard>
        }>
          <Route index            element={<CodeArena />} />
          <Route path="simulation" element={<SimulationDashboard />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="assets"    element={<AssetWiki />} />
          <Route path="history"   element={<Submissions />} />
          <Route path="calculating" element={<CalculatingResults />} />
          <Route path="wiki"      element={<RoundsWiki />} />
        </Route>

        {/* Default: redirect to role selector */}
        <Route path="*" element={<Navigate to="/select-role" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
