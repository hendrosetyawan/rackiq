import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { C, COMP_COLOR, PRIORITY_COLOR, glow } from '../lib/theme.js'
import { esc, tip, useSize } from '../lib/ui.js'

export const CATS = ['dimm', 'disk', 'psu', 'nic', 'fan', 'thermal', 'power', 'firmware', 'cabling']
export const CAT_COLOR = { ...COMP_COLOR, thermal: '#fb923c', power: '#facc15', firmware: '#94a3b8', cabling: '#5eead4', platform: '#fb923c' }
const CAT_LABEL = { dimm: 'DIMM', disk: 'DISK', psu: 'PSU', nic: 'NIC', fan: 'FAN', thermal: 'THERMAL', power: 'POWER', firmware: 'FW / SEC', cabling: 'CABLING' }

/* 12-month incident clock: angle = date, ring = category, dot size = downtime,
   color = priority, hollow = fix did not hold (recurred). */
export function RadialYear({ incidents, highlight }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!incidents) return
    const S = 600
    const svg = d3.select(ref.current).attr('viewBox', `${-S / 2} ${-S / 2} ${S} ${S}`)
    svg.selectAll('*').remove()
    const fglow = glow(svg, 'ryGlow', 2)
    const rows = incidents.map((d) => ({ ...d, t: new Date(d.opened_at) }))
    const end = d3.max(rows, (d) => d.t)
    const start = d3.timeDay.offset(end, -365)
    const a = d3.scaleTime().domain([start, end]).range([0, 2 * Math.PI])
    const r0 = 92
    const r1 = 262
    const rw = (r1 - r0) / CATS.length
    const ring = (c) => r0 + CATS.indexOf(c) * rw + rw / 2

    CATS.forEach((c, i) => {
      svg.append('circle').attr('r', r0 + i * rw).attr('fill', 'none').attr('stroke', C.line).attr('stroke-width', 0.6)
      svg.append('text').attr('x', 4).attr('y', -(ring(c)) + 3).attr('fill', CAT_COLOR[c]).attr('opacity', 0.9)
        .style('font', '600 7.5px Inter').style('letter-spacing', '.08em').text(CAT_LABEL[c])
    })
    svg.append('circle').attr('r', r1).attr('fill', 'none').attr('stroke', C.line2)
    d3.timeMonths(d3.timeMonth.ceil(start), end).forEach((m) => {
      const ang = a(m) - Math.PI / 2
      svg.append('line').attr('x1', Math.cos(ang) * r0).attr('y1', Math.sin(ang) * r0).attr('x2', Math.cos(ang) * (r1 + 6)).attr('y2', Math.sin(ang) * (r1 + 6))
        .attr('stroke', C.line2).attr('stroke-dasharray', '1 3')
      const mid = a(d3.timeDay.offset(m, 15)) - Math.PI / 2
      svg.append('text').attr('x', Math.cos(mid) * (r1 + 18)).attr('y', Math.sin(mid) * (r1 + 18) + 3).attr('text-anchor', 'middle')
        .attr('fill', C.muted).style('font', '600 9px JetBrains Mono').text(d3.timeFormat('%b')(m).toUpperCase())
    })
    // 30-day arc highlight
    svg.append('path').attr('d', d3.arc()({ innerRadius: r1 + 2, outerRadius: r1 + 5, startAngle: a(d3.timeDay.offset(end, -30)), endAngle: a(end) }))
      .attr('fill', C.cyan).attr('filter', fglow)

    const rad = (d) => Math.min(1.6 + Math.sqrt(d.downtime_min) / 2.4, 7)
    const jit = (d) => ((d3.sum(d.ticket_id, (ch) => ch.charCodeAt(0)) * 9301 + 49297) % 233280) / 233280 - 0.5
    const g = svg.append('g')
    g.selectAll('circle').data(rows.sort((x, y) => rad(y) - rad(x))).join('circle')
      .attr('cx', (d) => Math.cos(a(d.t) - Math.PI / 2) * (ring(d.component) + jit(d) * rw * 0.75))
      .attr('cy', (d) => Math.sin(a(d.t) - Math.PI / 2) * (ring(d.component) + jit(d) * rw * 0.75))
      .attr('r', rad)
      .attr('fill', (d) => (d.outcome === 'recurred' ? 'none' : PRIORITY_COLOR[d.priority]))
      .attr('fill-opacity', (d) => (highlight && d.component !== highlight ? 0.08 : 0.75))
      .attr('stroke', (d) => (d.outcome === 'recurred' ? '#fff' : 'none'))
      .attr('stroke-opacity', (d) => (highlight && d.component !== highlight ? 0.1 : 0.8))
      .attr('stroke-width', 0.9)
      .on('mouseenter', (e, d) => tip.show(`<div class="h">${d.ticket_id} · ${d.priority}</div>${d.opened_at.slice(0, 16).replace('T', ' ')} · ${esc(d.server_id)}<br/>
        <span class="k">${d.component}</span> · ${esc(d.template_id)}<br/>${esc(d.symptom).slice(0, 110)}<br/>
        <span class="k">MTTR</span> ${d.mttr_h} h · <span class="k">downtime</span> ${d.downtime_min} min · <b style="color:${d.outcome === 'recurred' ? C.crit : C.ok}">${d.outcome}</b>
        ${d.part_sku ? `<br/><span class="k">part</span> ${d.part_sku}` : ''}`, e))
      .on('mousemove', (e) => tip.move(e)).on('mouseleave', () => tip.hide())

    const last30 = rows.filter((d) => d.t >= d3.timeDay.offset(end, -30))
    svg.append('text').attr('text-anchor', 'middle').attr('y', -14).attr('fill', C.text).style('font', '600 30px JetBrains Mono').text(rows.length.toLocaleString())
    svg.append('text').attr('text-anchor', 'middle').attr('y', 4).attr('fill', C.muted).style('font', '9.5px Inter').style('letter-spacing', '.12em').text('INCIDENTS · 12 MO')
    svg.append('text').attr('text-anchor', 'middle').attr('y', 24).attr('fill', C.cyan).style('font', '11px JetBrains Mono').text(`${last30.length} in last 30 d`)
    svg.append('text').attr('text-anchor', 'middle').attr('y', 40).attr('fill', C.dim).style('font', '10px JetBrains Mono')
      .text(`${Math.round((rows.filter((d) => d.outcome === 'recurred').length / rows.length) * 100)}% recurred`)
  }, [incidents, highlight])
  return <svg ref={ref} style={{ width: '100%', height: '100%' }} />
}

/* Generic stacked stream chart (used for weekly incidents and monthly part consumption). */
export function StreamChart({ rows, keys, colors, xKey, parseX = (v) => new Date(v), offset = d3.stackOffsetNone, height: fixedH, fmt = (v) => v }) {
  const [wrap, size] = useSize()
  const ref = useRef(null)
  useEffect(() => {
    if (!rows || !rows.length || !size.width) return
    const width = size.width
    const height = fixedH || size.height
    const m = { t: 8, r: 8, b: 20, l: 28 }
    const svg = d3.select(ref.current).attr('width', width).attr('height', height)
    svg.selectAll('*').remove()
    const data = rows.map((r) => ({ ...r, _x: parseX(r[xKey]) }))
    const series = d3.stack().keys(keys).offset(offset).order(d3.stackOrderNone)(data)
    const x = d3.scaleTime().domain(d3.extent(data, (d) => d._x)).range([m.l, width - m.r])
    const y = d3.scaleLinear().domain([d3.min(series, (s) => d3.min(s, (d) => d[0])), d3.max(series, (s) => d3.max(s, (d) => d[1]))]).nice().range([height - m.b, m.t])
    svg.append('g').attr('transform', `translate(0,${height - m.b})`).call(d3.axisBottom(x).ticks(6).tickSize(0).tickPadding(6))
      .call((g) => { g.select('.domain').remove(); g.selectAll('text').attr('fill', C.dim).style('font', '9px JetBrains Mono') })
    if (offset === d3.stackOffsetNone)
      svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(3).tickSize(-(width - m.l - m.r)))
        .call((g) => { g.select('.domain').remove(); g.selectAll('line').attr('stroke', C.line).attr('stroke-dasharray', '2 4'); g.selectAll('text').attr('fill', C.dim).style('font', '9px JetBrains Mono') })
    const area = d3.area().x((d) => x(d.data._x)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveBasis)
    svg.append('g').selectAll('path').data(series).join('path').attr('d', area).attr('fill', (s) => colors[s.key]).attr('fill-opacity', 0.78)
      .attr('stroke', '#05080f').attr('stroke-width', 0.5)
      .on('mousemove', (e, s) => {
        const [mx] = d3.pointer(e)
        const i = d3.bisector((d) => d._x).center(data, x.invert(mx))
        const d = data[i]
        tip.show(`<div class="h">${d[xKey]}</div>${keys.map((k) => `<span style="color:${colors[k]}">${k}</span> ${fmt(d[k])}`).join(' · ')}`, e)
      })
      .on('mouseleave', () => tip.hide())
  }, [rows, keys, colors, xKey, parseX, offset, fixedH, size, fmt])
  return (
    <div ref={wrap} className="chart">
      <svg ref={ref} />
    </div>
  )
}
