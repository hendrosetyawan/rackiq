import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { CompChip, Loading, PageHead, Panel, StateChip, StockChip } from '../components/common.jsx'
import Copilot from '../components/Copilot.jsx'
import { ForecastBars, RiskMatrix } from '../charts/MaintCharts.jsx'
import { C, COMPONENTS, COMP_COLOR, COMP_LABEL, STOCK_COLOR, STOCK_LABEL, TIER_COLOR } from '../lib/theme.js'
import { useApi } from '../lib/ui.js'

export default function Maintenance({ overview }) {
  const navigate = useNavigate()
  const wo = useApi(api.workorders)
  const fc = useApi(api.forecast)
  const onOpen = useCallback((id) => navigate(`/asset/${id}`), [navigate])
  const maxP = wo.data ? Math.max(...wo.data.map((w) => w.priority_score)) : 1

  return (
    <>
      <PageHead title="Maintenance" sub="Predictive work orders · ranked by failure risk, operational criticality and spare-part availability" overview={overview} />
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.55fr) minmax(0,1fr)', height: 400, marginBottom: 12 }}>
        <Panel
          title="Risk matrix"
          sub={wo.data ? `${wo.data.length} signals · size = est. work` : ''}
          actions={
            <div className="legend">
              {COMPONENTS.map((c) => <span key={c}><i style={{ background: COMP_COLOR[c], borderRadius: '50%' }} />{COMP_LABEL[c]}</span>)}
              <span className="dim">|</span>
              {['stockout_risk', 'reorder'].map((s) => <span key={s}><i style={{ border: `2px solid ${STOCK_COLOR[s]}`, borderRadius: '50%', background: 'transparent' }} />{STOCK_LABEL[s]}</span>)}
            </div>
          }
        >
          {wo.data ? <RiskMatrix data={wo.data} onOpen={onOpen} /> : <Loading />}
        </Panel>
        <Panel title="Failure forecast vs spares" sub="next 72 h · ◆ = spares on hand">
          {fc.data ? <ForecastBars data={fc.data} /> : <Loading />}
        </Panel>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.55fr) minmax(0,1fr)', height: 'calc(100vh - 510px)', minHeight: 360 }}>
        <Panel title="Work queue" sub="click a row for the cited action plan" bodyStyle={{ overflow: 'auto', paddingTop: 2 }}>
          {wo.data ? (
            <table className="tbl">
              <thead>
                <tr><th>Priority</th><th>Asset</th><th>Part</th><th>Risk</th><th>Health</th><th>Context</th><th>Spare</th><th>Est.</th></tr>
              </thead>
              <tbody>
                {wo.data.slice(0, 60).map((w) => (
                  <tr key={w.asset_id} className="click" onClick={() => onOpen(w.asset_id)}>
                    <td style={{ width: 110 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="bar" style={{ width: 60 }}><div style={{ width: `${(w.priority_score / maxP) * 100}%`, background: TIER_COLOR[w.tier] }} /></div>
                        <span className="mono dim">{w.priority_score.toFixed(0)}</span>
                      </div>
                    </td>
                    <td className="mono">{w.server_id}</td>
                    <td><CompChip c={w.component} /></td>
                    <td className="mono" style={{ color: TIER_COLOR[w.tier] }}>{(w.risk_score * 100).toFixed(0)}%</td>
                    <td className="mono dim">{w.health_index}</td>
                    <td>{w.state !== 'normal' ? <StateChip state={w.state} /> : <span className="dim">—</span>}</td>
                    <td><StockChip status={w.part_status} /> <span className="mono dim">{w.on_hand}</span></td>
                    <td className="mono dim">{w.est_mttr_h?.toFixed(1)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Loading />
          )}
        </Panel>
        <Panel title="RCA copilot" sub="cited · ranked by durable-fix rate" bodyStyle={{ display: 'flex', flexDirection: 'column' }}>
          <Copilot />
        </Panel>
      </div>
      <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>
        Health = telemetry anomaly index (100 = at fleet baseline). "Watch" items deviate from baseline but are not predicted to fail within 72 h. <span style={{ color: C.muted }}>Priority = risk × criticality + spare-part shortage.</span>
      </div>
    </>
  )
}
