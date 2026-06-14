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
        </Route>

        {/* Default: redirect to role selector */}
        <Route path="*" element={<Navigate to="/select-role" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
