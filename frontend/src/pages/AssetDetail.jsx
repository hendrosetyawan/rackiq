import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client.js'
import RiskBadge from '../components/RiskBadge.jsx'
import ContextBadge from '../components/ContextBadge.jsx'
import CitationList from '../components/CitationList.jsx'

export default function AssetDetail() {
  const { assetId } = useParams()
  const [rec, setRec] = useState(null)
  const [telemetry, setTelemetry] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([api.recommend(assetId), api.telemetry(assetId, 24)])
      .then(([recData, telData]) => {
        setRec(recData)
        setTelemetry(telData)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [assetId])

  if (loading) return <div className="panel">Running prediction + evidence retrieval for {assetId}...</div>
  if (error) return <div className="panel error">Failed to load asset: {error}</div>
  if (!rec) return null

  return (
    <div className="asset-detail">
      <Link to="/" className="back-link">
        &larr; Back to dashboard
      </Link>

      <section className="panel asset-header">
        <div>
          <h2 className="mono">{rec.asset_id}</h2>
          <p className="uppercase muted">{rec.component}</p>
        </div>
        <div className="asset-header-right">
          {rec.risk_score != null && <RiskBadge score={rec.risk_score} />}
          <ContextBadge state={rec.operational_state} />
          <span className={`confidence-badge conf-${rec.confidence}`}>
            {rec.confidence} confidence recommendation
          </span>
        </div>
      </section>

      <section className="panel">
        <h3>Recommended action plan</h3>
        <ol className="steps-list">
          {rec.steps.map((s, i) => (
            <li key={i} className={`step step-${s.type}`}>
              {s.type === 'safety' && <span className="step-tag">SAFETY</span>}
              {s.type === 'signal' && <span className="step-tag">PREDICTION</span>}
              {s.type === 'action' && <span className="step-tag">FIX</span>}
              {s.type === 'related_via_graph' && <span className="step-tag">RELATED</span>}
              <span className="step-text">{s.text}</span>
              {s.outcome_note && <div className="step-outcome">{s.outcome_note}</div>}
              {s.citation_doc_id && (
                <div className="step-citation">
                  source: <span className="mono">{s.citation_doc_id}</span>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="panel">
        <h3>Evidence &amp; citations</h3>
        <CitationList citations={rec.citations} />
      </section>

      {telemetry && telemetry.length > 0 && (
        <section className="panel">
          <h3>Recent telemetry (last {telemetry.length} readings)</h3>
          <TelemetryTable rows={telemetry} />
        </section>
      )}
    </div>
  )
}

function TelemetryTable({ rows }) {
  const keys = Object.keys(rows[0]).filter((k) => k !== 'asset_id' && k !== 'timestamp')
  return (
    <div className="telemetry-table-wrap">
      <table className="telemetry-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            {keys.map((k) => (
              <th key={k}>{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="mono">{r.timestamp.replace('T', ' ').slice(0, 16)}</td>
              {keys.map((k) => (
                <td key={k}>{typeof r[k] === 'number' ? r[k].toFixed(2) : r[k]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
