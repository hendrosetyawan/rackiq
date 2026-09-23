import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'
import RiskBadge from '../components/RiskBadge.jsx'
import ContextBadge from '../components/ContextBadge.jsx'

export default function Dashboard() {
  const [risk, setRisk] = useState(null)
  const [error, setError] = useState(null)
  const [componentFilter, setComponentFilter] = useState('all')
  const [rackFilter, setRackFilter] = useState('all')

  useEffect(() => {
    api
      .risk()
      .then(setRisk)
      .catch((e) => setError(e.message))
  }, [])

  const racks = useMemo(() => {
    if (!risk) return []
    return Array.from(new Set(risk.map((r) => r.rack_id))).sort()
  }, [risk])

  const filtered = useMemo(() => {
    if (!risk) return []
    return risk.filter(
      (r) =>
        (componentFilter === 'all' || r.component === componentFilter) &&
        (rackFilter === 'all' || r.rack_id === rackFilter),
    )
  }, [risk, componentFilter, rackFilter])

  const alertCount = risk ? risk.filter((r) => r.risk_score >= 0.5).length : 0
  const hotCount = risk ? risk.filter((r) => r.operational_state !== 'normal').length : 0

  if (error) return <div className="panel error">Failed to load risk data: {error}</div>
  if (!risk) return <div className="panel">Loading fleet risk scores...</div>

  return (
    <div className="dashboard">
      <section className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-value">{risk.length}</span>
          <span className="kpi-label">Monitored components</span>
        </div>
        <div className="kpi-card kpi-alert">
          <span className="kpi-value">{alertCount}</span>
          <span className="kpi-label">Active alerts (risk &ge; 50%)</span>
        </div>
        <div className="kpi-card kpi-hot">
          <span className="kpi-value">{hotCount}</span>
          <span className="kpi-label">Assets in a sensitive operational window</span>
        </div>
      </section>

      <section className="filters">
        <label>
          Component
          <select value={componentFilter} onChange={(e) => setComponentFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="dimm">DIMM</option>
            <option value="disk">Disk</option>
            <option value="psu">PSU</option>
            <option value="nic">NIC</option>
          </select>
        </label>
        <label>
          Rack
          <select value={rackFilter} onChange={(e) => setRackFilter(e.target.value)}>
            <option value="all">All</option>
            {racks.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="panel">
        <table className="risk-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Component</th>
              <th>Rack / Server</th>
              <th>Vendor</th>
              <th>Failure risk</th>
              <th>Operational context</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 60).map((r) => (
              <tr key={r.asset_id} className={r.risk_score >= 0.5 ? 'row-alert' : ''}>
                <td className="mono">{r.asset_id}</td>
                <td className="uppercase">{r.component}</td>
                <td>
                  {r.rack_id} / {r.server_id}
                </td>
                <td>{r.vendor}</td>
                <td>
                  <RiskBadge score={r.risk_score} />
                </td>
                <td>
                  <ContextBadge state={r.operational_state} />
                </td>
                <td>
                  <Link className="link-btn" to={`/asset/${r.asset_id}`}>
                    Investigate
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 60 && (
          <p className="muted">Showing top 60 of {filtered.length} matching components, sorted by risk.</p>
        )}
      </section>
    </div>
  )
}
