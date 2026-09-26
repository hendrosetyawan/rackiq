import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { Loading, PageHead, Panel, StateChip, StockChip } from '../components/common.jsx'
import { StockHistory, StockRunway, TurnoverBubbles } from '../charts/InvCharts.jsx'
import { StreamChart } from '../charts/LogCharts.jsx'
import { C, STOCK_COLOR, STOCK_LABEL, TIER_COLOR } from '../lib/theme.js'
import { num, useApi, usd } from '../lib/ui.js'

const FAM_COLOR = { memory: C.blue, storage: C.violet, power: C.pink, cooling: '#cbd5e1', network: C.cyan }

export default function Inventory({ overview }) {
  const navigate = useNavigate()
  const inv = useApi(api.inventory)
  const hist = useApi(api.inventoryHistory)
  const cons = useApi(api.consumption)
  const [sku, setSku] = useState(null)
  useEffect(() => {
    if (!sku && inv.data) setSku(inv.data[0].sku)
  }, [inv.data, sku])
  const sel = inv.data?.find((d) => d.sku === sku)
  const kpi = useMemo(() => {
    if (!inv.data) return null
    const d = inv.data
    return {
      stockout: d.filter((x) => x.status === 'stockout_risk').length,
      reorder: d.filter((x) => x.status === 'reorder').length,
      value: d.reduce((s, x) => s + x.value_usd, 0),
      issued: d.reduce((s, x) => s + x.issued_12m, 0),
      turns: d.reduce((s, x) => s + x.issued_12m, 0) / d.reduce((s, x) => s + x.avg_on_hand, 0),
      demand: d.reduce((s, x) => s + x.ml_demand, 0),
      stockoutDays: d.reduce((s, x) => s + x.stockout_days_12m, 0),
    }
  }, [inv.data])
  const consRows = cons.data?.values
  const families = cons.data?.families

  return (
    <>
      <PageHead title="Inventory" sub="Spare-parts warehouse WH-DAL-1 · linked to live failure predictions and 12 months of consumption" overview={overview} />
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>
        {kpi ? (
          [
            ['Stockout risk', kpi.stockout, 'SKUs cannot cover predicted failures', C.crit],
            ['Reorder now', kpi.reorder, 'SKUs at / below reorder point after demand', C.warn],
            ['Predicted demand', kpi.demand.toFixed(1), 'units · Σ risk of flagged components', C.pink],
            ['Inventory value', usd(kpi.value), `${inv.data.length} SKUs on hand`, C.text],
            ['Turns / year', kpi.turns.toFixed(1), `${num(kpi.issued)} units issued in 12 months`, C.cyan],
            ['Stockout days', kpi.stockoutDays, 'SKU-days with backorders, 12 months', kpi.stockoutDays ? C.warn : C.ok],
          ].map(([l, v, s, c]) => (
            <div key={l} className="panel kpi" style={{ flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', minHeight: 82 }}>
              <div className="kpi-l">{l}</div>
              <div className="kpi-v" style={{ color: c }}>{v}</div>
              <div className="kpi-s">{s}</div>
            </div>
          ))
        ) : (
          Array.from({ length: 6 }, (_, i) => <div key={i} className="panel kpi" style={{ minHeight: 82 }} />)
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)', marginBottom: 12 }}>
        <Panel
          title="Stock runway"
          sub="click a SKU"
          actions={
            <div className="legend">
              {['stockout_risk', 'reorder', 'healthy'].map((s) => <span key={s}><i style={{ background: STOCK_COLOR[s] }} />{STOCK_LABEL[s]}</span>)}
              <span><i style={{ background: 'rgba(239,68,68,.35)' }} />reorder zone</span>
              <span style={{ color: C.pink }}>◆ predicted</span>
              <span>▼ +30d</span>
            </div>
          }
        >
          {inv.data ? <StockRunway data={inv.data} selected={sku} onSelect={setSku} /> : <Loading />}
        </Panel>
        <div className="grid" style={{ gridTemplateRows: '250px 230px', minHeight: 0 }}>
          <Panel title="Turnover vs cover" sub="size = stock value">
            {inv.data ? <TurnoverBubbles data={inv.data} selected={sku} onSelect={setSku} /> : <Loading />}
          </Panel>
          <Panel title={sel ? `${sel.sku} · 12-month stock` : 'Stock history'} sub={sel ? `bin ${sel.bin} · LT ${sel.lead_time_days} d` : ''}
            actions={<div className="legend"><span><i style={{ background: C.cyan }} />on hand</span><span><i style={{ background: C.violet }} />+ on order</span><span style={{ color: C.ok }}>▲ receipt</span><span style={{ color: C.crit }}>✕ backorder</span><span style={{ color: C.pink }}>| issue</span></div>}>
            {hist.data && sku ? <StockHistory hist={hist.data[sku]} sku={sku} /> : <Loading />}
          </Panel>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)', height: 280 }}>
        <Panel title="Parts consumption" sub="units issued per month by family"
          actions={<div className="legend">{(families || []).map((f) => <span key={f}><i style={{ background: FAM_COLOR[f] }} />{f}</span>)}</div>}>
          {consRows ? <StreamChart rows={consRows} keys={families} colors={FAM_COLOR} xKey="month" parseX={(m) => new Date(`${m}-15`)} /> : <Loading />}
        </Panel>
        <Panel title={sel ? `Assets depending on ${sel.sku}` : 'Linked assets'} sub={sel ? `${sel.linked_assets.length} flagged ≥ 50%` : ''} bodyStyle={{ overflow: 'auto' }}>
          {sel ? (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, fontSize: 11.5 }}>
                <StockChip status={sel.status} />
                <span className="muted">{sel.on_hand} on hand · {sel.inbound_qty} inbound{sel.next_arrival ? ` (ETA ${sel.next_arrival})` : ''} · projected 30d <b className="mono" style={{ color: sel.projected_30d < 0 ? C.crit : C.text }}>{sel.projected_30d.toFixed(1)}</b></span>
              </div>
              {sel.linked_assets.length === 0 && <div className="dim">No flagged components currently need this part.</div>}
              <table className="tbl">
                <tbody>
                  {sel.linked_assets.map((a) => (
                    <tr key={a.asset_id} className="click" onClick={() => navigate(`/asset/${a.asset_id}`)}>
                      <td className="mono">{a.asset_id}</td>
                      <td style={{ width: 120 }}><div className="bar"><div style={{ width: `${a.risk * 100}%`, background: a.risk >= 0.75 ? TIER_COLOR.critical : TIER_COLOR.warning }} /></div></td>
                      <td className="mono" style={{ color: a.risk >= 0.75 ? TIER_COLOR.critical : TIER_COLOR.warning }}>{Math.round(a.risk * 100)}%</td>
                      <td>{a.state !== 'normal' ? <StateChip state={a.state} /> : <span className="dim">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <Loading />
          )}
        </Panel>
      </div>
    </>
  )
}
