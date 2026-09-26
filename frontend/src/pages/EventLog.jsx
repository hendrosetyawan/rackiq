import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as d3 from 'd3'
import { api } from '../api/client.js'
import { Loading, PageHead, Panel } from '../components/common.jsx'
import { CATS, CAT_COLOR, RadialYear, StreamChart } from '../charts/LogCharts.jsx'
import { C, PRIORITY_COLOR } from '../lib/theme.js'
import { esc, useApi } from '../lib/ui.js'

const SEV_COLOR = { critical: C.crit, warning: C.warn, info: C.dim }
const STREAM_KEYS = ['dimm', 'disk', 'psu', 'nic', 'fan', 'platform']

export default function EventLog({ overview }) {
  const navigate = useNavigate()
  const inc = useApi(api.incidents)
  const ev = useApi(api.events)
  const [cat, setCat] = useState(null)
  const [sev, setSev] = useState('all')
  const [src, setSrc] = useState('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

  const weekly = useMemo(() => {
    if (!inc.data) return null
    const byWeek = d3.rollup(inc.data, (v) => v.length, (d) => d3.timeWeek.floor(new Date(d.opened_at)).toISOString().slice(0, 10),
      (d) => (CATS.indexOf(d.component) < 5 ? d.component : 'platform'))
    return [...byWeek.entries()].sort().map(([w, m]) => ({ week: w, ...Object.fromEntries(STREAM_KEYS.map((k) => [k, m.get(k) || 0])) }))
  }, [inc.data])

  const events = useMemo(() => {
    if (!ev.data) return []
    return ev.data.filter((e) => (sev === 'all' || e.severity === sev) && (src === 'all' || e.source === src))
  }, [ev.data, sev, src])
  const sources = useMemo(() => (ev.data ? [...new Set(ev.data.map((e) => e.source))] : []), [ev.data])

  const table = useMemo(() => {
    if (!inc.data) return []
    const s = q.toLowerCase()
    return inc.data
      .filter((d) => (!cat || d.component === cat) && (!s || `${d.ticket_id} ${d.server_id} ${d.template_id} ${d.symptom} ${d.part_sku}`.toLowerCase().includes(s)))
      .slice()
      .reverse()
  }, [inc.data, q, cat])
  const pages = Math.max(1, Math.ceil(table.length / 14))

  return (
    <>
      <PageHead title="Event Log" sub="12 months of incidents · 7-day MELT event stream (BMC SEL, syslog, SNMP, BMS, security, config)" overview={overview} />
      <div className="grid" style={{ gridTemplateColumns: '560px minmax(0,1fr)', height: 590, marginBottom: 12 }}>
        <Panel
          title="Incident clock"
          sub="ring = category · size = downtime · hollow = recurred"
          actions={<div className="legend">{['P1', 'P2', 'P3', 'P4'].map((p) => <span key={p}><i style={{ background: PRIORITY_COLOR[p], borderRadius: '50%' }} />{p}</span>)}</div>}
          bodyStyle={{ padding: 4 }}
        >
          {inc.data ? <RadialYear incidents={inc.data} highlight={cat} /> : <Loading />}
        </Panel>
        <div className="grid" style={{ gridTemplateRows: '210px minmax(0,1fr)', minHeight: 0 }}>
          <Panel
            title="Incidents per week"
            actions={
              <div className="legend">
                {CATS.slice(0, 5).map((c) => (
                  <span key={c} style={{ cursor: 'pointer', opacity: !cat || cat === c ? 1 : 0.4 }} onClick={() => setCat(cat === c ? null : c)}>
                    <i style={{ background: CAT_COLOR[c] }} />{c.toUpperCase()}
                  </span>
                ))}
                <span><i style={{ background: CAT_COLOR.platform }} />PLATFORM</span>
              </div>
            }
          >
            {weekly ? <StreamChart rows={weekly} keys={STREAM_KEYS} colors={CAT_COLOR} xKey="week" /> : <Loading />}
          </Panel>
          <Panel
            title="Event stream"
            sub={ev.data ? `${events.length} of ${ev.data.length} · last 7 days` : ''}
            actions={
              <div style={{ display: 'flex', gap: 6 }}>
                {['all', 'critical', 'warning', 'info'].map((s) => <button key={s} className={`pill-btn ${sev === s ? 'on' : ''}`} onClick={() => setSev(s)}>{s}</button>)}
                <select className="input" style={{ width: 110, padding: '3px 8px', fontSize: 11 }} value={src} onChange={(e) => setSrc(e.target.value)}>
                  <option value="all">all sources</option>
                  {sources.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            }
            bodyStyle={{ overflow: 'auto', paddingTop: 4 }}
          >
            {ev.data ? (
              <table className="tbl">
                <tbody>
                  {events.slice(0, 250).map((e, i) => (
                    <tr key={i} className={e.asset_id ? 'click' : ''} onClick={() => e.asset_id && navigate(`/asset/${e.asset_id}`)}>
                      <td className="mono dim">{e.timestamp.slice(5, 16).replace('T', ' ')}</td>
                      <td><i style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: SEV_COLOR[e.severity], boxShadow: e.severity !== 'info' ? `0 0 6px ${SEV_COLOR[e.severity]}` : 'none' }} /></td>
                      <td><span className="chip" style={{ fontSize: 10 }}>{e.source}</span></td>
                      <td className="mono">{e.server_id}</td>
                      <td style={{ whiteSpace: 'normal', color: e.severity === 'info' ? C.muted : C.text }} dangerouslySetInnerHTML={{ __html: esc(e.message) }} />
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
      <Panel
        title="Incident history"
        sub={`${table.length} tickets${cat ? ` · ${cat}` : ''}`}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" style={{ width: 260, padding: '5px 10px' }} placeholder="Search ticket, server, fix, SKU…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
            <button className="pill-btn" onClick={() => setPage(Math.max(0, page - 1))}>‹</button>
            <span className="mono dim">{page + 1}/{pages}</span>
            <button className="pill-btn" onClick={() => setPage(Math.min(pages - 1, page + 1))}>›</button>
          </div>
        }
      >
        {inc.data ? (
          <table className="tbl">
            <thead>
              <tr><th>Ticket</th><th>Opened</th><th>Pri</th><th>Server</th><th>Category</th><th>Fix</th><th>Outcome</th><th>MTTR</th><th>Down</th><th>Part</th><th>Symptom</th></tr>
            </thead>
            <tbody>
              {table.slice(page * 14, page * 14 + 14).map((d) => (
                <tr key={d.ticket_id} className={d.asset_id ? 'click' : ''} onClick={() => d.asset_id && navigate(`/asset/${d.asset_id}`)}>
                  <td className="mono">{d.ticket_id}</td>
                  <td className="mono dim">{d.opened_at.slice(0, 10)}</td>
                  <td className="mono" style={{ color: PRIORITY_COLOR[d.priority] }}>{d.priority}</td>
                  <td className="mono">{d.server_id}</td>
                  <td style={{ color: CAT_COLOR[d.component] }}>{d.component}</td>
                  <td className="mono dim">{d.template_id}</td>
                  <td style={{ color: d.outcome === 'recurred' ? C.crit : C.ok }}>{d.outcome}</td>
                  <td className="mono">{d.mttr_h.toFixed(1)}h</td>
                  <td className="mono dim">{d.downtime_min}m</td>
                  <td className="mono dim">{d.part_sku || '—'}</td>
                  <td style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', color: C.muted }} title={d.symptom}>{d.symptom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Loading />
        )}
      </Panel>
    </>
  )
}
