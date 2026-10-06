import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { Loading, PageHead, Panel } from '../components/common.jsx'
import { STATE_COLOR, STATE_LABEL } from '../lib/theme.js'
import { binSpot, rackFront } from '../live/layout.js'
import { LiveSim, STATUS_COLOR, STATUS_LABEL, STATUS_ORDER } from '../live/sim.js'

const DataHall = lazy(() => import('../live/DataHall.jsx'))
const SPEEDS = [
  [1, 'Live'],
  [10, '10×'],
  [60, '60×'],
  [360, '360×'],
]
const LEGEND_ORDER = ['healthy', 'watch', 'warning', 'critical', 'failed', 'maintenance', 'offline', 'empty']
const LOG_COLOR = { alert: '#ef4444', job: '#3b82f6', stock: '#f59e0b', shift: '#a78bfa' }
const hhmm = (t) => new Date(t).toTimeString().slice(0, 5)
const dur = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

function Battery({ v }) {
  const c = v < 20 ? '#ef4444' : v < 45 ? '#f59e0b' : '#22c55e'
  return (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: '#94a3b8' }}>
      <span style={{ width: 18, height: 8, border: '1px solid #475569', borderRadius: 2, padding: 1, display: 'inline-block' }}>
        <span style={{ display: 'block', height: '100%', width: `${v}%`, background: c, borderRadius: 1 }} />
      </span>
      {Math.round(v)}%
    </span>
  )
}

function Signal({ v }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 1, height: 9 }}>
      {[1, 2, 3, 4].map((i) => <span key={i} style={{ width: 2, height: 2 + i * 1.7, background: i <= v ? '#22d3ee' : '#334155' }} />)}
    </span>
  )
}

export default function LiveFloor({ overview }) {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const simRef = useRef(null)
  const agentsRef = useRef([])
  const lookupRef = useRef(new Map())
  const [, setTick] = useState(0)
  const [speed, setSpeed] = useState(60)
  const [selected, setSelected] = useState(null)
  const [followId, setFollowId] = useState(null)
  const [focus, setFocus] = useState(null)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    Promise.all([api.floor(), api.workorders(), api.inventory(), api.overview()])
      .then(([floor, workorders, inventory, ov]) => setData({ floor, workorders, inventory, asOf: ov.as_of }))
      .catch((e) => setErr(e.message))
  }, [])

  if (data && !simRef.current) {
    simRef.current = new LiveSim({ ...data, speed })
    agentsRef.current = simRef.current.agents
  }
  const sim = simRef.current

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    if (sim) sim.speed = speed
  }, [sim, speed])

  const now = performance.now()
  const crew = sim ? sim.agents.map((a) => ({ ...a, speaking: now < a.speechUntil })) : []
  const stock = sim ? [...sim.stock.values()] : []
  const activeJobs = sim ? sim.jobs.filter((j) => j.status === 'in_progress') : []
  const activeRacks = useMemo(() => [...new Set(activeJobs.map((j) => sim.servers.get(j.serverId).rack))], [activeJobs.map((j) => j.id).join()])

  if (err) return <div className="err">{err}</div>
  if (!sim) return <Loading />

  const counts = sim.counts()
  const win = sim.window()
  const shiftCrew = crew.filter((a) => a.shift === sim.shift.id && !a.leaving)
  const leaving = crew.filter((a) => a.leaving)
  const open = sim.jobs.filter((j) => j.status !== 'done')
  const waitingParts = open.filter((j) => j.status === 'queued' && j.sku && !j.partInHand && (sim.stock.get(j.sku)?.onHand ?? 0) <= 0)
  const doneShift = sim.jobs.filter((j) => j.status === 'done' && j.finished >= win.start.getTime())
  const simDate = new Date(sim.simTime)

  const pickAgent = (id) => {
    setSelected({ kind: 'agent', id })
    setFollowId(id)
  }
  const pickRack = (id) => {
    setSelected({ kind: 'rack', id })
    setFollowId(null)
    setFocus(rackFront(id))
  }
  const pickSku = (sku) => {
    setSelected({ kind: 'sku', id: sku })
    setFollowId(null)
    setFocus({ ...binSpot(sim.stock.get(sku).idx).stand })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 32px)' }}>
      <PageHead title="Live Floor" sub="3D digital twin of DH-1 · crew tablets, job progress, spare-part stock and server state in real time" overview={overview}>
        <div className="seg">
          {SPEEDS.map(([v, l]) => (
            <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)} title={v === 1 ? 'Real time' : `${v} simulated seconds per second`}>
              {l}
            </button>
          ))}
        </div>
      </PageHead>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="chip" style={{ borderColor: sim.shift.color, color: '#e2e8f0' }}>
          <i style={{ width: 8, height: 8, borderRadius: '50%', background: sim.shift.color, display: 'inline-block' }} />
          {sim.shift.name} shift {sim.shift.id} · {hhmm(win.start)}–{hhmm(win.end)}
        </span>
        <span className="mono" style={{ fontSize: 13, color: '#e2e8f0' }}>
          {simDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} {simDate.toTimeString().slice(0, 8)}
        </span>
        <span className="dim" style={{ fontSize: 11 }}>handover in {dur(win.end - simDate)}</span>
        <span style={{ flex: 1 }} />
        {LEGEND_ORDER.map((s) => (
          <span key={s} className="chip" title={STATUS_LABEL[s]} style={{ gap: 6 }}>
            <i style={{ width: 9, height: 9, borderRadius: 2, display: 'inline-block', background: s === 'empty' ? 'transparent' : STATUS_COLOR[s], border: s === 'empty' ? '1px dashed #64748b' : 'none', boxShadow: ['failed', 'critical'].includes(s) ? `0 0 6px ${STATUS_COLOR[s]}` : 'none' }} />
            {STATUS_LABEL[s]} <b className="mono" style={{ color: '#e2e8f0' }}>{counts[s]}</b>
          </span>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <section className="panel" style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
            <Suspense fallback={<Loading />}>
              <DataHall
                sim={sim}
                agentsRef={agentsRef}
                lookupRef={lookupRef}
                crew={crew}
                stock={stock}
                activeRacks={activeRacks}
                selected={selected}
                followId={followId}
                focus={focus}
                onHover={setHover}
                onPickRack={pickRack}
                onPickAgent={pickAgent}
                onPickSku={pickSku}
              />
            </Suspense>
            <div style={{ position: 'absolute', top: 10, left: 12, display: 'flex', gap: 6 }}>
              <button className="pill-btn" onClick={() => (setFollowId(null), setSelected(null), setFocus({ home: true }))}>Overview</button>
              <button className="pill-btn" onClick={() => (setFollowId(null), setFocus({ x: 1460, y: 860 }))}>Warehouse</button>
              <button className="pill-btn" onClick={() => (setFollowId(null), setFocus({ x: 500, y: 470 }))}>NOC</button>
              {followId && <button className="pill-btn" style={{ color: '#22d3ee', borderColor: '#22d3ee' }} onClick={() => setFollowId(null)}>Following {sim.agents.find((a) => a.id === followId)?.name ?? '—'} ✕</button>}
            </div>
            <div className="floor-legend" style={{ left: 'auto', right: 12, bottom: 10, fontSize: 10.5, color: '#94a3b8', lineHeight: 1.6 }}>
              <div><b style={{ color: '#ff2d55' }}>▮ red beam</b> server down · <b style={{ color: '#3b82f6' }}>◯ blue ring</b> job in progress</div>
              <div>LED blink: fast = down · medium = danger · slow = under service</div>
              <div>Rack kick-plate = ops state ({['dr_failover', 'migration', 'backup_window', 'maintenance_window'].map((s) => <b key={s} style={{ color: STATE_COLOR[s] }}>{STATE_LABEL[s]} </b>)})</div>
            </div>
            {hover && <HoverTip hover={hover} sim={sim} />}
            {selected && <Detail sel={selected} sim={sim} onClose={() => (setSelected(null), setFollowId(null))} onOpenAsset={(id) => navigate(`/asset/${id}`)} onPickAgent={pickAgent} />}
          </section>

          <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', height: 178, flex: 'none' }}>
            <Panel title="Live job feed" sub="from crew tablets + RackIQ" bodyStyle={{ overflow: 'auto', paddingTop: 4 }}>
              {sim.log.slice(0, 60).map((l, i) => (
                <div key={`${l.t}-${i}`} style={{ display: 'flex', gap: 8, fontSize: 11.5, padding: '2px 0', borderBottom: '1px solid #0f1a2e' }}>
                  <span className="mono dim">{hhmm(l.t)}</span>
                  <i style={{ width: 3, borderRadius: 2, background: LOG_COLOR[l.kind], flex: 'none' }} />
                  <span style={{ color: '#c3cde0' }}>{l.text}</span>
                </div>
              ))}
            </Panel>
            <Panel title="Work queue" sub="this shift">
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  ['Open jobs', open.length, '#e2e8f0'],
                  ['In progress', activeJobs.length, '#3b82f6'],
                  ['Closed this shift', doneShift.length, '#22c55e'],
                  ['Waiting for parts', waitingParts.length, waitingParts.length ? '#f97316' : '#64748b'],
                  ['Servers down', counts.failed, counts.failed ? '#ff2d55' : '#64748b'],
                  ['Critical queued', open.filter((j) => j.tier === 'critical' && j.status === 'queued').length, '#ef4444'],
                ].map(([l, v, c]) => (
                  <div key={l}>
                    <div className="kpi-l" style={{ marginBottom: 1 }}>{l}</div>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: c }}>{v}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <Panel title="Crew on duty" sub={`${shiftCrew.length} tablets online`} style={{ flex: 'none' }} bodyStyle={{ paddingTop: 4 }}>
            {[...shiftCrew, ...leaving].map((a) => (
              <CrewCard key={a.id} a={a} sim={sim} active={selected?.kind === 'agent' && selected.id === a.id} onClick={() => pickAgent(a.id)} shiftColor={sim.shift.color} />
            ))}
          </Panel>
          <Panel title="Warehouse stock" sub="live bin counts" style={{ flex: 1, minHeight: 0 }} bodyStyle={{ overflow: 'auto', paddingTop: 2 }}>
            {stock.map((s) => {
              const c = s.onHand <= 0 ? '#ef4444' : s.onHand <= s.reorderPoint ? '#f97316' : '#22c55e'
              const max = Math.max(s.reorderPoint * 2, s.onHand, 6)
              const waiting = open.filter((j) => j.sku === s.sku && j.status === 'queued').length
              return (
                <div key={s.sku} onClick={() => pickSku(s.sku)} style={{ padding: '5px 4px', borderBottom: '1px solid #0f1a2e', cursor: 'pointer', background: selected?.id === s.sku ? 'rgba(34,211,238,.07)' : 'transparent' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                    <span className="mono">{s.sku}</span>
                    <span className="mono" style={{ color: c, fontWeight: 600 }}>{s.onHand}</span>
                  </div>
                  <div style={{ position: 'relative', height: 4, background: '#121b30', borderRadius: 2, margin: '3px 0' }}>
                    <div style={{ width: `${(Math.min(s.onHand, max) / max) * 100}%`, height: '100%', background: c, borderRadius: 2 }} />
                    <div style={{ position: 'absolute', left: `${(s.reorderPoint / max) * 100}%`, top: -2, width: 1, height: 8, background: '#e2e8f0', opacity: 0.6 }} />
                  </div>
                  <div className="dim" style={{ fontSize: 10.5, display: 'flex', gap: 8 }}>
                    <span>bin {s.bin}</span>
                    <span>ROP {s.reorderPoint}</span>
                    {s.picked > 0 && <span>{s.picked} picked</span>}
                    {s.inbound > 0 && <span style={{ color: '#a3e635' }}>+{s.inbound} in {dur(s.eta - sim.simTime)}</span>}
                    {waiting > 0 && <span style={{ color: '#f97316' }}>{waiting} jobs waiting</span>}
                  </div>
                </div>
              )
            })}
          </Panel>
        </div>
      </div>
    </div>
  )
}

function CrewCard({ a, sim, active, onClick, shiftColor }) {
  const job = a.job && sim.jobs.find((j) => j.id === a.job)
  return (
    <div onClick={onClick} style={{ padding: '6px 8px', margin: '0 -4px 4px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${active ? '#22d3ee' : '#15213a'}`, background: active ? 'rgba(34,211,238,.06)' : 'rgba(8,13,26,.5)', opacity: a.leaving ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <i style={{ width: 8, height: 8, borderRadius: a.role === 'superintendent' ? 2 : '50%', background: a.leaving ? '#64748b' : a.role === 'superintendent' ? '#f8fafc' : shiftColor, flex: 'none' }} />
        <b style={{ fontWeight: 600 }}>{a.name}</b>
        <span className="dim" style={{ fontSize: 10.5 }}>{a.role === 'superintendent' ? 'Supt.' : 'Tech'} · {a.device}</span>
        <span style={{ flex: 1 }} />
        <Signal v={a.signal} />
        <Battery v={a.battery} />
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3, display: 'flex', gap: 6 }}>
        <span style={{ color: '#64748b', flex: 'none' }}>{sim.zoneOf(a)}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: a.leaving ? '#64748b' : '#c3cde0' }}>{a.leaving ? 'Off shift — leaving' : a.activity}</span>
      </div>
      {(a.progress > 0 || job) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          {job && <span className="mono" style={{ fontSize: 10, color: '#3b82f6' }}>{job.id}</span>}
          {a.carrying && <span className="mono" style={{ fontSize: 10, color: '#c49a5c' }}>📦 {a.carrying}</span>}
          <div style={{ flex: 1, height: 4, background: '#121b30', borderRadius: 2 }}>
            <div style={{ width: `${(a.progress || (job?.done ?? 0)) * 100}%`, height: '100%', background: '#3b82f6', borderRadius: 2 }} />
          </div>
        </div>
      )}
    </div>
  )
}

function HoverTip({ hover, sim }) {
  const rack = sim.rackById.get(hover.id)
  const srv = hover.slot ? sim.servers.get(`${hover.id}-S${hover.slot}`) : null
  const box = { position: 'fixed', left: hover.x + 14, top: hover.y + 12, pointerEvents: 'none', zIndex: 20 }
  return (
    <div className="tt" style={{ ...box, opacity: 1 }}>
      <b>{srv ? srv.id : `Rack ${hover.id}`}</b>
      {srv ? (
        <>
          <div style={{ color: STATUS_COLOR[srv.status] === '#0b1120' ? '#94a3b8' : STATUS_COLOR[srv.status] }}>{STATUS_LABEL[srv.status]}</div>
          <div className="dim">{srv.model} · {srv.workload}</div>
          {srv.status !== 'empty' && <div className="dim">risk {(srv.risk * 100).toFixed(0)}% · worst {srv.worstComponent?.toUpperCase()}</div>}
        </>
      ) : (
        <div className="dim">{rack.vendor} · {rack.workload} · {STATE_LABEL[rack.state]}</div>
      )}
    </div>
  )
}

function Detail({ sel, sim, onClose, onOpenAsset, onPickAgent }) {
  const card = { position: 'absolute', left: 12, top: 46, width: 300, maxHeight: 'calc(100% - 60px)', overflow: 'auto', background: 'rgba(6,10,20,.92)', border: '1px solid #26395e', borderRadius: 10, padding: '10px 12px', fontSize: 11.5 }
  const close = <button className="pill-btn" style={{ float: 'right', padding: '1px 8px' }} onClick={onClose}>✕</button>
  if (sel.kind === 'rack') {
    const r = sim.rackById.get(sel.id)
    const jobs = sim.jobs.filter((j) => j.status !== 'done' && sim.servers.get(j.serverId).rack === r.id)
    return (
      <div style={card}>
        {close}
        <div style={{ fontSize: 14, fontWeight: 700 }}>Rack {r.id}</div>
        <div className="dim" style={{ marginBottom: 6 }}>{r.vendor} · {r.workload} · <span style={{ color: STATE_COLOR[r.state] }}>{STATE_LABEL[r.state]}</span></div>
        {Array.from({ length: 8 }, (_, i) => sim.servers.get(`${r.id}-S${i + 1}`)).map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
            <span className="mono dim" style={{ width: 22 }}>S{s.slot}</span>
            <i style={{ width: 10, height: 10, borderRadius: 2, background: s.status === 'empty' ? 'transparent' : STATUS_COLOR[s.status], border: s.status === 'empty' ? '1px dashed #64748b' : 'none' }} />
            <span style={{ width: 92 }}>{STATUS_LABEL[s.status]}</span>
            <span className="dim" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.status === 'empty' ? '—' : s.model}</span>
          </div>
        ))}
        {jobs.length > 0 && <div className="up dim" style={{ marginTop: 8 }}>Open jobs</div>}
        {jobs.map((j) => {
          const tech = sim.agents.find((a) => a.id === j.tech)
          return (
            <div key={j.id} className="step" style={{ padding: '6px 8px', marginTop: 4, marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="mono" style={{ color: '#3b82f6' }}>{j.id}</span>
                <span className="dim">{j.status.replace('_', ' ')}{j.status === 'in_progress' ? ` · ${Math.round(j.done * 100)}%` : ''}</span>
              </div>
              <div>{j.kind} {j.component.toUpperCase()} · {j.serverId}{j.sku ? ` · ${j.sku}` : ''}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                {tech ? <a onClick={() => onPickAgent(tech.id)} style={{ cursor: 'pointer' }}>{tech.name} ({tech.device})</a> : <span className="dim">unassigned</span>}
                <a onClick={() => onOpenAsset(j.assetId)} style={{ cursor: 'pointer' }}>cited plan →</a>
              </div>
            </div>
          )
        })}
      </div>
    )
  }
  if (sel.kind === 'agent') {
    const a = sim.agents.find((x) => x.id === sel.id)
    if (!a) return null
    const job = a.job && sim.jobs.find((j) => j.id === a.job)
    const mine = sim.log.filter((l) => l.who === a.name).slice(0, 6)
    return (
      <div style={card}>
        {close}
        <div style={{ fontSize: 14, fontWeight: 700 }}>{a.name}</div>
        <div className="dim">{a.role === 'superintendent' ? 'Shift superintendent' : 'Field technician'} · shift {a.shift} · tablet {a.device}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '6px 0' }}>
          <Battery v={a.battery} /> <Signal v={a.signal} /> <span className="dim">{sim.zoneOf(a)}</span>
        </div>
        <div style={{ color: '#e2e8f0' }}>{a.activity}</div>
        {a.progress > 0 && <div className="bar" style={{ margin: '4px 0' }}><i style={{ display: 'block', width: `${a.progress * 100}%`, height: '100%', background: '#3b82f6' }} /></div>}
        {job && (
          <div className="step" style={{ padding: '6px 8px', marginTop: 6 }}>
            <span className="mono" style={{ color: '#3b82f6' }}>{job.id}</span> {job.kind} {job.component.toUpperCase()} on {job.serverId}
            <div className="dim">{job.sku ? `part ${job.sku}${a.carrying ? ' (carrying)' : ''}` : 'no part needed'} · est {job.hours.toFixed(1)} h</div>
            <a onClick={() => onOpenAsset(job.assetId)} style={{ cursor: 'pointer' }}>cited action plan →</a>
          </div>
        )}
        {mine.length > 0 && <div className="up dim" style={{ marginTop: 6 }}>Tablet log</div>}
        {mine.map((l, i) => <div key={i} style={{ color: '#94a3b8', padding: '2px 0' }}><span className="mono dim">{hhmm(l.t)}</span> {l.text}</div>)}
      </div>
    )
  }
  const s = sim.stock.get(sel.id)
  const waiting = sim.jobs.filter((j) => j.sku === s.sku && j.status !== 'done')
  return (
    <div style={card}>
      {close}
      <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{s.sku}</div>
      <div className="dim" style={{ marginBottom: 6 }}>{s.desc} · bin {s.bin}</div>
      <div>On hand <b className="mono">{s.onHand}</b> · reorder point {s.reorderPoint} · reorder qty {s.reorderQty}</div>
      <div className="dim">Lead time {s.leadDays} d · ${s.unitCost} / unit · {s.picked} picked since open</div>
      {s.inbound > 0 && <div style={{ color: '#a3e635', marginTop: 4 }}>PO inbound: {s.inbound} units, arrives in {dur(s.eta - sim.simTime)}</div>}
      {waiting.length > 0 && <div className="up dim" style={{ marginTop: 8 }}>Jobs needing this part</div>}
      {waiting.slice(0, 8).map((j) => (
        <div key={j.id} style={{ padding: '2px 0' }}>
          <span className="mono" style={{ color: '#3b82f6' }}>{j.id}</span> {j.serverId} · <span style={{ color: j.tier === 'failed' ? '#ff2d55' : '#94a3b8' }}>{j.tier}</span> · {j.status.replace('_', ' ')}
        </div>
      ))}
    </div>
  )
}
