import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client.js'
import { CompChip, Loading, PageHead, Panel, StateChip, StockChip, TierChip } from '../components/common.jsx'
import { Gauge } from '../charts/Gauge.jsx'
import { ChannelMultiples, ShapBars } from '../charts/AssetCharts.jsx'
import { C, PRIORITY_COLOR, TIER_COLOR } from '../lib/theme.js'
import { useApi } from '../lib/ui.js'

const TAG = {
  safety: ['SAFETY', C.watch],
  signal: ['PREDICTION', C.cyan],
  action: ['FIX', C.ok],
  caution: ['DO NOT REPEAT', C.crit],
  related_via_graph: ['GRAPH', C.violet],
}

function Part({ p }) {
  if (!p || !p.sku) return null
  return (
    <div className="part">
      <span className="mono" style={{ color: C.text }}>{p.qty} × {p.sku}</span>
      <StockChip status={p.status} />
      <span className="muted">{p.on_hand} on hand{p.inbound_qty ? ` · ${p.inbound_qty} inbound${p.next_arrival ? ` ETA ${p.next_arrival}` : ''}` : ''} · bin {p.bin} · lead {p.lead_time_days} d</span>
      <Link to="/inventory" style={{ fontSize: 11 }}>inventory →</Link>
    </div>
  )
}

export default function AssetDetail({ overview }) {
  const { assetId } = useParams()
  const a = useApi(() => api.asset(assetId), [assetId])
  const rec = useApi(() => api.recommend(assetId), [assetId])
  const [openCite, setOpenCite] = useState(null)
  const d = a.data
  const r = rec.data
  const drivers = d ? d.top_factors.filter((f) => f.shap_contribution > 0).map((f) => f.feature.replace(/_(mean|max|slope|latest)$/, '')) : []

  return (
    <>
      <PageHead title={assetId} sub={d ? `${d.vendor} ${d.model} · ${d.workload} · rack ${d.rack_id} slot ${d.slot}` : 'Loading asset…'} overview={overview}>
        <Link to={d ? `/?rack=${d.rack_id}` : '/'} className="pill-btn">← floor</Link>
        <Link to="/maintenance" className="pill-btn">work queue</Link>
      </PageHead>
      {a.error && <div className="err">{a.error}</div>}
      {d && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', alignItems: 'start' }}>
          <div className="grid">
            <div className="panel" style={{ padding: '12px 14px', flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <Gauge size={104} value={d.risk_score * 100} fmt={(v) => `${v.toFixed(0)}%`} unit="72h risk" color={TIER_COLOR[d.tier]}
                bands={[[0, 25, C.ok], [25, 50, C.watch], [50, 75, C.warn], [75, 100, C.crit]]} />
              <Gauge size={104} value={d.health_index} fmt={(v) => v.toFixed(0)} unit="health" color={(v) => (v >= 80 ? C.ok : v >= 50 ? C.watch : C.crit)} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <CompChip c={d.component} />
                  <TierChip tier={d.tier} />
                  <StateChip state={d.state} />
                  {r && <span className="chip" style={{ color: r.confidence === 'high' ? C.ok : C.watch }}>{r.confidence} confidence</span>}
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>anomaly z {d.anomaly_z} · server {d.server_id}</div>
                {d.sku && <div style={{ fontSize: 11.5 }}><span className="mono">{d.sku.sku}</span> <StockChip status={d.sku.status} /> <span className="muted">{d.sku.on_hand} spares</span></div>}
              </div>
            </div>
            <Panel title="Action plan" sub="deterministic agent · every step cited">
              {d.tier === 'healthy' && (
                <div className="step" style={{ borderColor: 'rgba(16,185,129,.35)' }}>
                  <span className="step-tag" style={{ color: C.ok, background: `${C.ok}22` }}>HEALTHY</span>
                  <div style={{ marginTop: 5, fontSize: 12.5 }}>No failure predicted and telemetry is at fleet baseline — no action needed.{r ? ' Reference procedures for this component are listed below.' : ''}</div>
                </div>
              )}
              {r ? (
                r.steps.map((s, i) => {
                  const [label, color] = TAG[s.type] || ['STEP', C.muted]
                  return (
                    <div key={i} className="step" style={{ borderColor: s.type === 'safety' ? 'rgba(234,179,8,.35)' : s.type === 'caution' ? 'rgba(239,68,68,.35)' : undefined }}>
                      <span className="step-tag" style={{ color, background: `${color}22` }}>{label}</span>
                      {s.template_id && <span className="mono dim" style={{ fontSize: 10.5 }}>{s.template_id}</span>}
                      <div style={{ marginTop: 5, fontSize: 12.5, lineHeight: 1.5 }}>{s.text}</div>
                      {s.root_cause && <div className="note">Root cause: {s.root_cause}</div>}
                      {s.outcome_note && <div className="note" style={{ color: s.type === 'caution' ? C.crit : C.muted }}>{s.outcome_note}</div>}
                      <Part p={s.part} />
                      {s.citation_doc_id && <div className="note">source <span className="mono" style={{ color: C.cyan }}>{s.citation_doc_id}</span></div>}
                    </div>
                  )
                })
              ) : rec.loading ? (
                <Loading label="Retrieving evidence" />
              ) : null}
            </Panel>
            <Panel title="Evidence" sub={r ? `${r.citations.length} cited documents` : 'none needed'}>
              {r?.citations.map((c, i) => (
                <div key={c.doc_id} className="step" style={{ cursor: 'pointer', padding: '7px 10px' }} onClick={() => setOpenCite(openCite === i ? null : i)}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                    <span className="mono" style={{ color: C.cyan }}>{c.doc_id}</span>
                    <span className="chip" style={{ fontSize: 10 }}>{c.doc_type}</span>
                    <span className="mono dim">{c.source_ref}</span>
                    <span className="dim">{c.date}</span>
                    {c.match_score != null && <span className="dim">match {Math.round(c.match_score * 100)}%</span>}
                    <span style={{ marginLeft: 'auto', color: c.success ? C.ok : C.crit }}>{c.success ? 'held' : 'recurred'}</span>
                  </div>
                  {openCite === i && <div className="cite">{c.excerpt}…</div>}
                </div>
              ))}
            </Panel>
          </div>
          <div className="grid">
            <Panel title="Prediction drivers" sub="SHAP contributions (LightGBM)">
              <ShapBars factors={d.top_factors} />
            </Panel>
            <Panel title="Component telemetry" sub={`last ${d.series.timestamp.length} readings · shaded = live window`}>
              <ChannelMultiples series={d.series} channels={d.channels} highlight={drivers} />
            </Panel>
            <Panel title="Server context" sub={d.server_id}>
              <ChannelMultiples series={d.server_series} channels={Object.keys(d.server_series).filter((k) => k !== 'timestamp')} color={C.violet} />
            </Panel>
            <Panel title="Server incident history" sub="12 months">
              {d.server_incidents.length === 0 && <div className="dim">No incidents on this server in 12 months.</div>}
              <table className="tbl">
                <tbody>
                  {d.server_incidents.map((x) => (
                    <tr key={x.ticket_id}>
                      <td className="mono">{x.ticket_id}</td>
                      <td className="mono dim">{x.opened_at.slice(0, 10)}</td>
                      <td className="mono" style={{ color: PRIORITY_COLOR[x.priority] }}>{x.priority}</td>
                      <td>{x.component}</td>
                      <td className="mono dim">{x.template_id}</td>
                      <td style={{ color: x.outcome === 'recurred' ? C.crit : C.ok }}>{x.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        </div>
      )}
      {a.loading && !d && <Loading label="Loading asset" />}
    </>
  )
}
