import { NavLink, Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard.jsx'
import IncidentCopilot from './pages/IncidentCopilot.jsx'
import AssetDetail from './pages/AssetDetail.jsx'
import { api } from './api/client.js'

export default function App() {
  return (
    <div className="app-shell">
      {api.isDemoMode && (
        <div className="demo-banner">
          Static hosted demo &mdash; precomputed data snapshot, no live backend. Incident Copilot
          answers a fixed set of example questions. Run locally for the full live pipeline (see
          the repository's <code>instructions_to_run.txt</code>).
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">RackIQ</span>
          <span className="brand-sub">Predictive Failure &amp; RCA Copilot</span>
        </div>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            Risk Dashboard
          </NavLink>
          <NavLink to="/copilot" className={({ isActive }) => (isActive ? 'active' : '')}>
            Incident Copilot
          </NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/copilot" element={<IncidentCopilot />} />
          <Route path="/asset/:assetId" element={<AssetDetail />} />
        </Routes>
      </main>
      <footer className="app-footer">
        Prototype build for ABB Accelerator 2026 &middot; synthetic telemetry &amp; knowledge base &middot; no
        external LLM call (deterministic, cited recommendation pipeline)
      </footer>
    </div>
  )
}
