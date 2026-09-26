import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { Loading, PageHead, Panel } from '../components/common.jsx'
import { Gauge } from '../charts/Gauge.jsx'
import { FacilityTrend, ModelTelemetry, ParallelCoords, RackRadar, ThermalMatrix } from '../charts/OpsCharts.jsx'
import { C, STATE_COLOR, STATE_LABEL, TIER, TIER_COLOR, TIER_LABEL, thermal } from '../lib/theme.js'
import { num, pct, useApi } from '../lib/ui.js'

function GaugeTile({ label, sub, ...g }) {
  return (
    <div className="panel kpi">
      <Gauge size={84} {...g} />
      <div>
        <div className="kpi-l">{label}</div>
        <div className="kpi-s" style={{ color: C.muted, fontSize: 11.5 }}>{sub}</div>
      </div>
    </div>
  )
}

export default function Operations({ overview: o }) {
  const navigate = useNavigate()
  const floor = useApi(api.floor)
  const servers = useApi(api.servers)
  const facility = useApi(api.facility)
  const thermalM = useApi(api.thermal)
  const models = useApi(api.modelTelemetry)
  const [count, setCount] = useState(null)
  const onCount = useCallback((n) => setCount(n), [])
  const onSelect = useCallback((id) => navigate(`/?rack=${id}`), [navigate])

  const fabric = useMemo(() => {
    if (!servers.data) return null
    const cap = servers.data.reduce((s, x) => s + (x.workload === 'ai' ? 200 : 50), 0)
    const used = servers.data.reduce((s, x) => s + x.net_throughput_gbps, 0)
    const mem = servers.data.reduce((s, x) => s + x.mem_util_pct, 0) / servers.data.length
    return { cap, used, mem }
  }, [servers.data])

  return (
    <>
      <PageHead title="Operations" sub="Real-time infrastructure telemetry · power, thermal, compute, network, AI models" overview={o} />
      <div className="kpis">
        {o && fabric ? (
          <>
            <GaugeTile label="IT load" value={o.it_power_kw} max={o.capacity_kw} fmt={(v) => `${Math.round(v)}`} unit="kW" color={C.cyan}
              sub={`${Math.round((o.it_power_kw / o.capacity_kw) * 100)}% of ${num(o.capacity_kw)} kW`} />
            <GaugeTile label="PUE" value={o.pue} min={1} max={2} fmt={(v) => v.toFixed(2)} color={(v) => (v < 1.4 ? C.ok : v < 1.6 ? C.watch : C.crit)}
              bands={[[1, 1.4, C.ok], [1.4, 1.6, C.watch], [1.6, 2, C.crit]]} sub={`${num(o.facility_power_kw)} kW facility`} />
            <GaugeTile label="Inlet avg" value={o.avg_inlet_c} min={16} max={32} fmt={(v) => v.toFixed(1)} unit="°C" color={thermal}
              bands={[[18, 27, C.ok], [27, 32, C.crit]]} sub={`max ${o.max_inlet_c}°C`} />
            <GaugeTile label="CPU util" value={o.avg_cpu_pct} fmt={(v) => `${v.toFixed(0)}%`} color={C.violet} sub={`memory ${fabric.mem.toFixed(0)}%`} />
            <GaugeTile label="Fabric util" value={(fabric.used / fabric.cap) * 100} fmt={(v) => `${v.toFixed(0)}%`} color={C.blue}
              sub={`${num(fabric.used / 1000, 1)} / ${num(fabric.cap / 1000, 0)} Tbps`} />
            <GaugeTile label="Packet loss" value={o.avg_packet_loss_pct} max={0.2} fmt={(v) => v.toFixed(3)} unit="%"
              color={(v) => (v < 0.05 ? C.ok : C.warn)} bands={[[0, 0.05, C.ok], [0.05, 0.2, C.warn]]} sub="avg, SNMP" />
          </>
        ) : (
          Array.from({ length: 6 }, (_, i) => <div key={i} className="panel kpi" />)
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '460px minmax(0,1fr)', height: 440, marginBottom: 12 }}>
        <Panel title="Rack radar" sub="length = kW · color = inlet · node = flagged · ring = context" bodyStyle={{ padding: 6 }}>
          {floor.data ? <RackRadar floor={floor.data} onSelect={onSelect} /> : <Loading />}
        </Panel>
        <Panel
          title="Server telemetry · 800 servers"
          sub="drag on any axis to filter"
          actions={
            <div className="legend">
              {TIER.map((t) => <span key={t}><i style={{ background: TIER_COLOR[t] }} />{TIER_LABEL[t]}</span>)}
              <span className="mono" style={{ color: C.cyan }}>{count ?? '—'} selected</span>
            </div>
          }
        >
          {servers.data ? <ParallelCoords servers={servers.data} onCount={onCount} /> : <Loading />}
        </Panel>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', height: 270, marginBottom: 12 }}>
        <Panel title="Facility power & PUE" sub="90 days"
          actions={<div className="legend"><span><i style={{ background: C.cyan }} />IT kW</span><span><i style={{ background: C.violet }} />Facility kW</span><span><i style={{ background: C.watch }} />PUE</span></div>}>
          {facility.data ? <FacilityTrend data={facility.data} /> : <Loading />}
        </Panel>
        <Panel title="Thermal matrix" sub="daily avg inlet · 100 racks × 90 days"
          actions={<div className="legend"><span>19°</span><span style={{ width: 90, height: 7, borderRadius: 4, background: `linear-gradient(90deg, ${[19, 21.5, 24, 26.5, 29].map(thermal).join(',')})` }} /><span>29°C</span></div>}>
          {thermalM.data ? <ThermalMatrix data={thermalM.data} /> : <Loading />}
        </Panel>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)' }}>
        <Panel title="AI telemetry" sub="RackIQ's own models: accuracy, drift, confidence, latency">
          {models.data ? <ModelTelemetry data={models.data} /> : <Loading />}
        </Panel>
        <Panel title="Detection vs synthetic ground truth" sub="live degradations injected by the generator">
          {models.data?.ground_truth ? (
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', height: '100%' }}>
              <Gauge size={96} value={models.data.ground_truth.recall_at_0_5 * 100} fmt={(v) => `${v.toFixed(0)}%`} unit="recall" color={C.cyan} />
              <Gauge size={96} value={models.data.ground_truth.precision_at_0_5 * 100} fmt={(v) => `${v.toFixed(0)}%`} unit="precision" color={C.ok} />
              <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                {models.data.ground_truth.injected} degradations injected<br />
                recall @25% risk {pct(models.data.ground_truth.recall_at_0_25)}<br />
                <span className="dim">Synthetic data — expect lower on real telemetry.</span>
              </div>
            </div>
          ) : (
            <Loading />
          )}
        </Panel>
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        {Object.keys(STATE_LABEL).filter((s) => s !== 'normal').map((s) => (
          <span key={s}><i style={{ background: STATE_COLOR[s], borderRadius: '50%' }} />{STATE_LABEL[s]}</span>
        ))}
        <span className="dim">· MELT telemetry: metrics, events and logs. Distributed traces are out of scope for a hardware copilot.</span>
      </div>
    </>
  )
}
