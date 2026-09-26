import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.js'
import { CompChip, Loading, PageHead, Panel, StateChip } from '../components/common.jsx'
import FloorMap3D from '../charts/FloorMap3D.jsx'
import RackElevation from '../charts/RackElevation.jsx'
import { Gauge, Sparkline } from '../charts/Gauge.jsx'
import { C, STATE_COLOR, STATE_LABEL, TIER, TIER_COLOR, TIER_LABEL, thermal } from '../lib/theme.js'
import { num, useApi, usd } from '../lib/ui.js'

export function KpiStrip({ o }) {
  if (!o) return <div className="kpis">{Array.from({ length: 6 }, (_, i) => <div key={i} className="panel kpi" />)}</div>
  const atRisk = o.server_tiers.critical + o.server_tiers.warning + o.server_tiers.watch
  const healthColor = (v) => (v >= 92 ? C.ok : v >= 80 ? C.watch : C.crit)
  return (
    <div className="kpis">
      <div className="panel kpi">
        <Gauge size={78} value={o.health_score} color={healthColor} fmt={(v) => v.toFixed(0)} bands={[[0, 80, C.crit], [80, 92, C.watch], [92, 100, C.ok]]} />
        <div>
          <div className="kpi-l">Fleet health</div>
          <div className="kpi-v" style={{ color: healthColor(o.health_score) }}>{o.health_score.toFixed(1)}</div>
          <div className="kpi-s">{atRisk}/{o.counts.servers} flagged</div>
        </div>
      </div>
      <div className="panel kpi">
        <Gauge size={78} value={o.it_power_kw} max={o.capacity_kw} color={C.cyan} fmt={(v) => `${Math.round((v / o.capacity_kw) * 100)}%`} unit="of cap" />
        <div>
          <div className="kpi-l">IT load</div>
          <div className="kpi-v">{num(o.it_power_kw)}<span className="dim" style={{ fontSize: 12 }}> kW</span></div>
          <Sparkline values={o.spark.it_power_kw} width={84} />
        </div>
      </div>
      <div className="panel kpi">
        <Gauge size={78} value={o.pue} min={1} max={2} fmt={(v) => v.toFixed(2)} color={(v) => (v < 1.4 ? C.ok : v < 1.6 ? C.watch : C.crit)}
          bands={[[1, 1.4, C.ok], [1.4, 1.6, C.watch], [1.6, 2, C.crit]]} />
        <div>
          <div className="kpi-l">PUE</div>
          <div className="kpi-v">{o.pue.toFixed(3)}</div>
          <Sparkline values={o.spark.pue} width={84} color={C.watch} />
        </div>
      </div>
      <div className="panel kpi">
        <Gauge size={78} value={o.avg_inlet_c} min={16} max={32} fmt={(v) => v.toFixed(1)} unit="avg °C" color={thermal}
          bands={[[16, 18, C.blue], [18, 27, C.ok], [27, 32, C.crit]]} />
        <div>
          <div className="kpi-l">Inlet max</div>
          <div className="kpi-v" style={{ color: thermal(o.max_inlet_c) }}>{o.max_inlet_c.toFixed(1)}°</div>
          <div className="kpi-s">max · {o.hot_racks} racks &gt;27°</div>
        </div>
      </div>
      <div className="panel kpi" style={{ flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 2 }}>
        <div className="kpi-l">Predictive alerts</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div className="kpi-v" style={{ color: C.crit }}>{o.critical}</div>
          <div className="kpi-s">critical · {o.alerts} ≥50% risk · {o.component_tiers.watch} watch</div>
        </div>
        <div className="tierbar">
          {TIER.slice(1).map((t) => (
            <div key={t} style={{ width: `${(o.server_tiers[t] / Math.max(atRisk, 1)) * 100}%`, background: TIER_COLOR[t] }} title={`${TIER_LABEL[t]}: ${o.server_tiers[t]}`} />
          ))}
        </div>
        <div className="kpi-s">{o.sensitive_racks} racks in a sensitive operational window</div>
      </div>
      <div className="panel kpi" style={{ flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 2 }}>
        <div className="kpi-l">Spares at risk</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div className="kpi-v" style={{ color: o.stock.stockout_risk ? C.crit : C.ok }}>{o.stock.stockout_risk}</div>
          <div className="kpi-s">stockout · {o.stock.reorder} reorder · {o.stock.skus} SKUs</div>
        </div>
        <div className="kpi-s" style={{ marginTop: 6 }}>On hand {usd(o.stock.value_usd)} · MTTR 30d {o.mttr_30d_h} h</div>
        <Sparkline values={o.spark.incidents} width={170} height={22} color={C.violet} />
      </div>
    </div>
  )
}

function Legend({ mode }) {
  if (mode === 'thermal')
    return (
      <div className="legend">
        <span>19°C</span>
        <span style={{ width: 120, height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${[19, 21.5, 24, 26.5, 29].map((t) => thermal(t)).join(',')})` }} />
        <span>29°C inlet</span>
      </div>
    )
  if (mode === 'power')
    return (
      <div className="legend">
        <span>low</span>
        <span style={{ width: 120, height: 8, borderRadius: 4, background: 'linear-gradient(90deg,#0c2d48,#67e8f9)' }} />
        <span>high server draw</span>
      </div>
    )
  return (
    <div className="legend">
      {TIER.map((t) => (
        <span key={t}><i style={{ background: TIER_COLOR[t] }} />{TIER_LABEL[t]}</span>
      ))}
      <span className="dim">|</span>
      {['dr_failover', 'migration', 'backup_window', 'maintenance_window'].map((s) => (
        <span key={s}><i style={{ background: STATE_COLOR[s], borderRadius: '50%', boxShadow: `0 0 6px ${STATE_COLOR[s]}` }} />{STATE_LABEL[s]}</span>
      ))}
    </div>
  )
}

export default function CommandCenter({ overview }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const floor = useApi(api.floor)
  const wo = useApi(api.workorders)
  const [mode, setMode] = useState('health')
  const [selected, setSelected] = useState(params.get('rack'))

  useEffect(() => {
    if (!selected && floor.data) {
      const worst = [...floor.data.racks].sort((a, b) => b.n_crit - a.n_crit || b.max_risk - a.max_risk)[0]
      setSelected(worst.rack_id)
    }
  }, [floor.data, selected])
  const onSelect = useCallback((id) => {
    setSelected(id)
    setParams({ rack: id }, { replace: true })
  }, [setParams])
  const onOpen = useCallback((id) => navigate(`/asset/${id}`), [navigate])
  const rack = useMemo(() => floor.data?.racks.find((r) => r.rack_id === selected), [floor.data, selected])

  return (
    <>
      <PageHead title="Command Center" sub="Data hall DH-1 · 5 rows × 20 racks · live predictive health" overview={overview} />
      <KpiStrip o={overview} />
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 356px', height: 'calc(100vh - 226px)', minHeight: 540 }}>
        <Panel
          title="Data hall floor"
          sub="click a rack · hover a slot"
          actions={
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <div className="seg">
                {['health', 'thermal', 'power'].map((m) => (
                  <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>
                ))}
              </div>
            </div>
          }
          bodyStyle={{ padding: '4px 10px 8px' }}
        >
          {floor.data ? <FloorMap3D floor={floor.data} mode={mode} selected={selected} onSelect={onSelect} /> : <Loading label="Rendering data hall" />}
          <div className="floor-legend"><Legend mode={mode} /></div>
        </Panel>
        <div className="grid" style={{ gridTemplateRows: 'auto minmax(0,1fr)', minHeight: 0 }}>
          <Panel
            title={rack ? `Rack ${rack.rack_id}` : 'Rack'}
            sub={rack ? `${rack.vendor} · ${rack.workload}` : ''}
            actions={rack && <StateChip state={rack.state} />}
          >
            {rack ? (
              <>
                <div style={{ display: 'flex', gap: 14, fontSize: 11, color: C.muted, marginBottom: 8 }}>
                  <span><b className="mono" style={{ color: C.text }}>{rack.power_kw.toFixed(1)}</b> / {rack.capacity_kw} kW</span>
                  <span>inlet max <b className="mono" style={{ color: thermal(rack.max_inlet) }}>{rack.max_inlet}°C</b></span>
                  <span>{rack.cooling_zone}</span>
                </div>
                <RackElevation rack={rack} onOpen={onOpen} />
              </>
            ) : (
              <Loading />
            )}
          </Panel>
          <Panel title="Priority queue" sub="risk × criticality × parts" bodyStyle={{ overflow: 'auto', padding: '4px 8px 8px' }}>
            {wo.data ? (
              <table className="tbl">
                <tbody>
                  {wo.data.slice(0, 14).map((w) => (
                    <tr key={w.asset_id} className="click" onClick={() => onOpen(w.asset_id)}>
                      <td style={{ width: 10 }}><span className="chip" style={{ padding: 0, border: 0 }}><i style={{ background: TIER_COLOR[w.tier], boxShadow: `0 0 6px ${TIER_COLOR[w.tier]}`, width: 7, height: 7, borderRadius: '50%' }} /></span></td>
                      <td className="mono">{w.server_id}</td>
                      <td><CompChip c={w.component} /></td>
                      <td className="mono" style={{ color: TIER_COLOR[w.tier] }}>{Math.round(w.risk_score * 100)}%</td>
                      <td>{w.state !== 'normal' && <i title={STATE_LABEL[w.state]} style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: STATE_COLOR[w.state], boxShadow: `0 0 6px ${STATE_COLOR[w.state]}` }} />}</td>
                      <td className="mono dim" style={{ textAlign: 'right' }}>{w.priority_score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Loading />
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}
