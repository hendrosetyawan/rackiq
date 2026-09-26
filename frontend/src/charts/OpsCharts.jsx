import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { C, COMPONENTS, COMP_COLOR, COMP_LABEL, STATE_COLOR, STATE_LABEL, TIER, TIER_COLOR, glow, thermal } from '../lib/theme.js'
import { esc, tip, useSize } from '../lib/ui.js'

/* ------------------------------------------------------------------ Rack radar
   One spoke per rack. Bar length = IT power, bar color = max inlet temperature,
   outer node = worst slot status (size = flagged servers), inner ring = operational
   context. Four criteria for 100 racks in one circle. */
export function RackRadar({ floor, onSelect }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!floor) return
    const S = 590
    const svg = d3.select(ref.current).attr('viewBox', `${-S / 2} ${-S / 2} ${S} ${S}`)
    svg.selectAll('*').remove()
    const fglow = glow(svg, 'rrGlow', 2.5)
    const rows = floor.rows
    const per = floor.racks_per_row
    const slots = rows.length * (per + 1)
    const r0 = 86
    const L = 150
    const maxKw = d3.max(floor.racks, (r) => r.power_kw)
    const len = d3.scaleSqrt().domain([0, maxKw]).range([6, L])
    const band = ((2 * Math.PI) / slots) * 0.74
    const ang = (r) => ((rows.indexOf(r.row) * (per + 1) + r.pos - 1) / slots) * 2 * Math.PI
    ;[2, 5, 10, 20, 30].filter((k) => k <= maxKw * 1.05).forEach((k) => {
      svg.append('circle').attr('r', r0 + len(k)).attr('fill', 'none').attr('stroke', C.line).attr('stroke-dasharray', '2 4')
      svg.append('text').attr('x', 3).attr('y', -(r0 + len(k)) - 2).attr('fill', C.dim).style('font', '8.5px JetBrains Mono').text(`${k} kW`)
    })
    svg.append('circle').attr('r', r0 - 12).attr('fill', 'rgba(34,211,238,0.03)').attr('stroke', C.line2)
    const arc = d3.arc()
    const g = svg.append('g')
    floor.racks.forEach((r) => {
      const a = ang(r)
      const n = r.n_crit + r.n_warn + r.n_watch
      const grp = g.append('g').style('cursor', 'pointer')
        .on('mouseenter', function (e) {
          d3.select(this).select('.bar').attr('stroke', '#fff')
          tip.show(`<div class="h">Rack ${r.rack_id}</div>${r.vendor} · ${r.workload}<br/>
            <span class="k">IT power</span> <b>${r.power_kw.toFixed(1)} kW</b> / ${r.capacity_kw} kW<br/>
            <span class="k">Inlet max</span> <b style="color:${thermal(r.max_inlet)}">${r.max_inlet}°C</b> <span class="k">avg ${r.avg_inlet}</span><br/>
            <span class="k">Flagged servers</span> <b style="color:${TIER_COLOR[r.status]}">${n}</b> (${r.n_crit} critical)<br/>
            ${r.state !== 'normal' ? `<span style="color:${STATE_COLOR[r.state]}">● ${STATE_LABEL[r.state]}</span>` : ''}`, e)
        })
        .on('mousemove', (e) => tip.move(e))
        .on('mouseleave', function () {
          d3.select(this).select('.bar').attr('stroke', 'none')
          tip.hide()
        })
        .on('click', () => onSelect && onSelect(r.rack_id))
      grp.append('path').attr('class', 'bar')
        .attr('d', arc({ innerRadius: r0, outerRadius: r0 + len(r.power_kw), startAngle: a - band / 2, endAngle: a + band / 2 }))
        .attr('fill', thermal(r.max_inlet)).attr('opacity', 0.9)
      grp.append('path').attr('d', arc({ innerRadius: r0 - 9, outerRadius: r0 - 4, startAngle: a - band / 2, endAngle: a + band / 2 }))
        .attr('fill', r.state === 'normal' ? '#13203a' : STATE_COLOR[r.state]).attr('filter', r.state === 'normal' ? null : fglow)
      const x = Math.sin(a) * (r0 + L + 16)
      const y = -Math.cos(a) * (r0 + L + 16)
      grp.append('circle').attr('cx', x).attr('cy', y).attr('r', n ? Math.min(2.2 + n * 1.1, 7.5) : 1.6)
        .attr('fill', n ? TIER_COLOR[r.status] : C.dim).attr('filter', r.n_crit ? fglow : null)
        .attr('class', r.n_crit ? 'pulse' : null)
    })
    rows.forEach((row, i) => {
      const a = ((i * (per + 1) + (per - 1) / 2) / slots) * 2 * Math.PI
      const wl = floor.racks.find((r) => r.row === row).workload
      const rr = r0 + L + 36
      svg.append('text').attr('x', Math.sin(a) * rr).attr('y', -Math.cos(a) * rr + 4).attr('text-anchor', 'middle')
        .attr('fill', C.text).style('font', '600 12px JetBrains Mono').text(row)
      svg.append('text').attr('x', Math.sin(a) * rr).attr('y', -Math.cos(a) * rr + 16).attr('text-anchor', 'middle')
        .attr('fill', C.dim).style('font', '8.5px Inter').text(wl)
    })
    const total = d3.sum(floor.racks, (r) => r.power_kw)
    svg.append('text').attr('text-anchor', 'middle').attr('y', -4).attr('fill', C.text).style('font', '600 26px JetBrains Mono').text(Math.round(total))
    svg.append('text').attr('text-anchor', 'middle').attr('y', 14).attr('fill', C.muted).style('font', '10px Inter').style('letter-spacing', '.1em').text('IT kW · 100 RACKS')
    const hot = floor.racks.filter((r) => r.max_inlet > 27).length
    svg.append('text').attr('text-anchor', 'middle').attr('y', 32).attr('fill', hot ? C.warn : C.ok).style('font', '10px JetBrains Mono').text(`${hot} racks > 27°C`)
  }, [floor, onSelect])
  return <svg ref={ref} style={{ width: '100%', height: '100%' }} />
}

/* ------------------------------------------------------------------ Parallel coordinates */
const PC_DIMS = [
  ['cpu_util_pct', 'CPU %'], ['mem_util_pct', 'Mem %'], ['power_w', 'Power W'], ['inlet_temp_c', 'Inlet °C'],
  ['outlet_temp_c', 'Outlet °C'], ['net_throughput_gbps', 'Net Gbps'], ['net_latency_ms', 'Latency ms'],
  ['packet_loss_pct', 'Loss %'], ['disk_latency_ms', 'Disk ms'], ['max_risk', 'Fail risk'],
]
export function ParallelCoords({ servers, onCount }) {
  const [wrap, size] = useSize()
  const ref = useRef(null)
  useEffect(() => {
    if (!servers || !size.width) return
    const { width, height } = size
    const m = { t: 26, r: 18, b: 12, l: 18 }
    const svg = d3.select(ref.current).attr('width', width).attr('height', height)
    svg.selectAll('*').remove()
    const x = d3.scalePoint().domain(PC_DIMS.map((d) => d[0])).range([m.l, width - m.r])
    const y = {}
    PC_DIMS.forEach(([k]) => {
      const ext = k === 'max_risk' ? [0, 1] : d3.extent(servers, (s) => s[k])
      y[k] = d3.scaleLinear().domain(ext).nice().range([height - m.b, m.t])
    })
    const line = d3.line()
    const path = (s) => line(PC_DIMS.map(([k]) => [x(k), y[k](s[k] ?? 0)]))
    const order = { healthy: 0, watch: 1, warning: 2, critical: 3 }
    const data = [...servers].sort((a, b) => order[a.status] - order[b.status])
    const lines = svg.append('g').selectAll('path').data(data).join('path')
      .attr('d', path).attr('fill', 'none')
      .attr('stroke', (s) => (s.status === 'healthy' ? C.cyan : TIER_COLOR[s.status]))
      .attr('stroke-opacity', (s) => (s.status === 'healthy' ? 0.08 : 0.55))
      .attr('stroke-width', (s) => (s.status === 'healthy' ? 0.8 : 1.3))
      .on('mouseenter', function (e, s) {
        d3.select(this).raise().attr('stroke-width', 2.6).attr('stroke-opacity', 1)
        tip.show(`<div class="h">${s.server_id}</div>${s.workload} · ${s.vendor}<br/><span class="k">risk</span> <b style="color:${TIER_COLOR[s.status]}">${(s.max_risk * 100).toFixed(1)}%</b> · ${s.worst_component}<br/>
          <span class="k">CPU</span> ${s.cpu_util_pct.toFixed(0)}% · <span class="k">power</span> ${Math.round(s.power_w)} W · <span class="k">inlet</span> ${s.inlet_temp_c.toFixed(1)}°C`, e)
      })
      .on('mousemove', (e) => tip.move(e))
      .on('mouseleave', function (e, s) {
        d3.select(this).attr('stroke-width', s.status === 'healthy' ? 0.8 : 1.3).attr('stroke-opacity', active(s) ? (s.status === 'healthy' ? 0.07 : 0.75) : 0.02)
        tip.hide()
      })
    const brushes = {}
    const active = (s) => Object.entries(brushes).every(([k, [a, b]]) => s[k] >= a && s[k] <= b)
    const update = () => {
      lines.attr('stroke-opacity', (s) => (active(s) ? (s.status === 'healthy' ? 0.12 : 0.85) : 0.02))
      onCount && onCount(servers.filter(active).length)
    }
    PC_DIMS.forEach(([k, label]) => {
      const ax = svg.append('g').attr('data-dim', k).attr('transform', `translate(${x(k)},0)`)
      ax.call(d3.axisLeft(y[k]).ticks(4).tickSize(3)).call((g) => {
        g.select('.domain').attr('stroke', C.line2)
        g.selectAll('text').attr('fill', C.dim).style('font', '8.5px JetBrains Mono')
        g.selectAll('line').attr('stroke', C.line2)
      })
      ax.append('text').attr('y', 12).attr('text-anchor', 'middle').attr('fill', C.muted).style('font', '600 9.5px Inter').text(label)
      const br = d3.brushY().extent([[-9, m.t], [9, height - m.b]]).on('brush end', (ev) => {
        if (ev.selection) brushes[k] = ev.selection.map(y[k].invert).sort((a, b) => a - b)
        else delete brushes[k]
        update()
      })
      ax.append('g').call(br).call((g) => g.selectAll('.selection').attr('fill', C.cyan).attr('fill-opacity', 0.15).attr('stroke', C.cyan))
    })
    onCount && onCount(servers.length)
  }, [servers, size, onCount])
  return (
    <div ref={wrap} className="chart">
      <svg ref={ref} />
    </div>
  )
}

/* ------------------------------------------------------------------ Facility trend */
export function FacilityTrend({ data }) {
  const [wrap, size] = useSize()
  const ref = useRef(null)
  useEffect(() => {
    if (!data || !size.width) return
    const { width, height } = size
    const m = { t: 10, r: 40, b: 22, l: 44 }
    const svg = d3.select(ref.current).attr('width', width).attr('height', height)
    svg.selectAll('*').remove()
    const rows = data.map((d) => ({ ...d, t: new Date(d.date) }))
    const x = d3.scaleTime().domain(d3.extent(rows, (d) => d.t)).range([m.l, width - m.r])
    const y = d3.scaleLinear().domain([d3.min(rows, (d) => d.it_power_kw) * 0.9, d3.max(rows, (d) => d.facility_power_kw) * 1.04]).range([height - m.b, m.t])
    const yp = d3.scaleLinear().domain(d3.extent(rows, (d) => d.pue)).nice().range([height - m.b - 4, m.t + 4])
    const defs = svg.append('defs')
    const mk = (id, c, o) => {
      const lg = defs.append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1)
      lg.append('stop').attr('offset', '0%').attr('stop-color', c).attr('stop-opacity', o)
      lg.append('stop').attr('offset', '100%').attr('stop-color', c).attr('stop-opacity', 0)
    }
    mk('ftIt', C.cyan, 0.45)
    mk('ftFac', C.violet, 0.25)
    svg.append('g').attr('transform', `translate(0,${height - m.b})`).call(d3.axisBottom(x).ticks(6).tickSize(0).tickPadding(8))
      .call((g) => { g.select('.domain').remove(); g.selectAll('text').attr('fill', C.dim).style('font', '9px JetBrains Mono') })
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(width - m.l - m.r)))
      .call((g) => { g.select('.domain').remove(); g.selectAll('line').attr('stroke', C.line).attr('stroke-dasharray', '2 4'); g.selectAll('text').attr('fill', C.dim).style('font', '9px JetBrains Mono') })
    svg.append('g').attr('transform', `translate(${width - m.r},0)`).call(d3.axisRight(yp).ticks(4).tickSize(0).tickPadding(6))
      .call((g) => { g.select('.domain').remove(); g.selectAll('text').attr('fill', C.watch).style('font', '9px JetBrains Mono') })
    const area = (k) => d3.area().x((d) => x(d.t)).y0(height - m.b).y1((d) => y(d[k])).curve(d3.curveMonotoneX)
    svg.append('path').datum(rows).attr('d', area('facility_power_kw')).attr('fill', 'url(#ftFac)')
    svg.append('path').datum(rows).attr('d', area('it_power_kw')).attr('fill', 'url(#ftIt)')
    svg.append('path').datum(rows).attr('fill', 'none').attr('stroke', C.cyan).attr('stroke-width', 1.5)
      .attr('d', d3.line().x((d) => x(d.t)).y((d) => y(d.it_power_kw)).curve(d3.curveMonotoneX))
    svg.append('path').datum(rows).attr('fill', 'none').attr('stroke', C.violet).attr('stroke-width', 1).attr('stroke-dasharray', '3 3')
      .attr('d', d3.line().x((d) => x(d.t)).y((d) => y(d.facility_power_kw)).curve(d3.curveMonotoneX))
    svg.append('path').datum(rows).attr('fill', 'none').attr('stroke', C.watch).attr('stroke-width', 1.6)
      .attr('d', d3.line().x((d) => x(d.t)).y((d) => yp(d.pue)).curve(d3.curveMonotoneX))
    const hover = svg.append('line').attr('y1', m.t).attr('y2', height - m.b).attr('stroke', C.muted).attr('stroke-dasharray', '2 3').attr('opacity', 0)
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', width - m.l - m.r).attr('height', height - m.t - m.b).attr('fill', 'transparent')
      .on('mousemove', (e) => {
        const [mx] = d3.pointer(e)
        const i = d3.bisector((d) => d.t).center(rows, x.invert(mx))
        const d = rows[i]
        hover.attr('x1', x(d.t)).attr('x2', x(d.t)).attr('opacity', 1)
        tip.show(`<div class="h">${d.date}</div><span style="color:${C.cyan}">IT</span> ${d.it_power_kw.toFixed(0)} kW · <span style="color:${C.violet}">facility</span> ${d.facility_power_kw.toFixed(0)} kW<br/>
          <span style="color:${C.watch}">PUE</span> ${d.pue.toFixed(3)} · outside ${d.outside_temp_c.toFixed(1)}°C<br/><span class="k">inlet avg/max</span> ${d.avg_inlet_c.toFixed(1)} / ${d.max_inlet_c.toFixed(1)}°C`, e)
      })
      .on('mouseleave', () => { hover.attr('opacity', 0); tip.hide() })
  }, [data, size])
  return (
    <div ref={wrap} className="chart">
      <svg ref={ref} />
    </div>
  )
}

/* ------------------------------------------------------------------ Thermal matrix (100 racks x 90 days) */
export function ThermalMatrix({ data }) {
  const [wrap, size] = useSize()
  const ref = useRef(null)
  useEffect(() => {
    if (!data || !size.width) return
    const { width, height } = size
    const m = { t: 4, r: 8, b: 20, l: 30 }
    const svg = d3.select(ref.current).attr('width', width).attr('height', height)
    svg.selectAll('*').remove()
    const n = data.racks.length
    const nd = data.dates.length
    const cw = (width - m.l - m.r) / nd
    const ch = (height - m.t - m.b) / n
    const g = svg.append('g')
    data.values.forEach((row, i) =>
      row.forEach((v, j) => {
        if (v == null) return
        g.append('rect').attr('x', m.l + j * cw).attr('y', m.t + i * ch).attr('width', cw + 0.3).attr('height', ch + 0.3).attr('fill', thermal(v))
      }),
    )
    g.on('mousemove', (e) => {
      const [mx, my] = d3.pointer(e)
      const j = Math.floor((mx - m.l) / cw)
      const i = Math.floor((my - m.t) / ch)
      if (i < 0 || j < 0 || i >= n || j >= nd) return
      const v = data.values[i][j]
      tip.show(`<div class="h">${data.racks[i]}</div>${data.dates[j]}<br/><span class="k">avg inlet</span> <b style="color:${thermal(v)}">${v?.toFixed(2)}°C</b>`, e)
    }).on('mouseleave', () => tip.hide())
    const rows = [...new Set(data.racks.map((r) => r[0]))]
    rows.forEach((row) => {
      const first = data.racks.findIndex((r) => r[0] === row)
      const count = data.racks.filter((r) => r[0] === row).length
      svg.append('text').attr('x', m.l - 8).attr('y', m.t + (first + count / 2) * ch + 4).attr('text-anchor', 'end').attr('fill', C.muted).style('font', '600 10px JetBrains Mono').text(row)
      if (first > 0) svg.append('line').attr('x1', m.l).attr('x2', width - m.r).attr('y1', m.t + first * ch).attr('y2', m.t + first * ch).attr('stroke', C.bg).attr('stroke-width', 1.5)
    })
    const x = d3.scaleTime().domain([new Date(data.dates[0]), new Date(data.dates[nd - 1])]).range([m.l, width - m.r])
    svg.append('g').attr('transform', `translate(0,${height - m.b + 2})`).call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(6))
      .call((a) => { a.select('.domain').remove(); a.selectAll('text').attr('fill', C.dim).style('font', '9px JetBrains Mono') })
  }, [data, size])
  return (
    <div ref={wrap} className="chart">
      <svg ref={ref} />
    </div>
  )
}

/* ------------------------------------------------------------------ AI telemetry (the models monitoring themselves) */
export function ModelTelemetry({ data }) {
  const [wrap, size] = useSize()
  const ref = useRef(null)
  useEffect(() => {
    if (!data || !size.width) return
    const { width } = size
    const rowH = 30
    const top = 22
    const height = top + rowH * COMPONENTS.length + 4
    const svg = d3.select(ref.current).attr('width', width).attr('height', height)
    svg.selectAll('*').remove()
    const cols = [
      { k: 'test_auc', label: 'AUC · HELD-OUT', dom: [0.9, 1], fmt: (v) => v.toFixed(3), good: (v) => v >= 0.95 },
      { k: 'psi_max', label: 'FEATURE DRIFT · PSI', dom: [0, 0.3], fmt: (v) => v.toFixed(3), good: (v) => v < 0.1, marks: [0.1, 0.25] },
      { k: 'mean_confidence', label: 'MEAN CONFIDENCE', dom: [0.9, 1], fmt: (v) => v.toFixed(3), good: (v) => v >= 0.97 },
      { k: 'inference_us_per_asset', label: 'INFERENCE · µs/ASSET', dom: [0, 2500], fmt: (v) => v.toFixed(0), good: () => true },
    ]
    const x0 = 58
    const cw = (width - x0) / cols.length
    cols.forEach((c, ci) => svg.append('text').attr('x', x0 + ci * cw).attr('y', 11).attr('fill', C.dim).style('font', '600 9px Inter').style('letter-spacing', '.06em').text(c.label))
    COMPONENTS.forEach((comp, i) => {
      const m = data.models[comp]
      const y = top + i * rowH
      svg.append('text').attr('x', 0).attr('y', y + 14).attr('fill', COMP_COLOR[comp]).style('font', '600 11px JetBrains Mono').text(COMP_LABEL[comp])
      cols.forEach((c, ci) => {
        const v = m[c.k]
        const bx = x0 + ci * cw
        const bw = cw - 64
        const s = d3.scaleLinear().domain(c.dom).range([0, bw]).clamp(true)
        svg.append('rect').attr('x', bx).attr('y', y + 7).attr('width', bw).attr('height', 6).attr('rx', 3).attr('fill', '#111b31')
        svg.append('rect').attr('x', bx).attr('y', y + 7).attr('width', s(v)).attr('height', 6).attr('rx', 3).attr('fill', c.good(v) ? C.cyan : C.warn)
        ;(c.marks || []).forEach((mk) => svg.append('line').attr('x1', bx + s(mk)).attr('x2', bx + s(mk)).attr('y1', y + 4).attr('y2', y + 16).attr('stroke', mk === 0.25 ? C.crit : C.watch))
        svg.append('text').attr('x', bx + bw + 8).attr('y', y + 14).attr('fill', C.text).style('font', '10.5px JetBrains Mono').text(c.fmt(v))
      })
    })
  }, [data, size])
  return (
    <div ref={wrap} style={{ width: '100%' }}>
      <svg ref={ref} />
    </div>
  )
}

export { TIER }
