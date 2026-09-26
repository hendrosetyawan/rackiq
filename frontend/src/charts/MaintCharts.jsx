import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { C, COMP_COLOR, COMP_LABEL, STATE_LABEL, STOCK_COLOR, STOCK_LABEL, TIER_COLOR, glow } from '../lib/theme.js'
import { tip, useSize } from '../lib/ui.js'

/* Risk matrix: x = 72h failure risk, y = operational criticality (workload tier +
   live context), bubble size = expected work time, fill = component, ring = spare-part
   status. Five criteria per work order in one view. */
export function RiskMatrix({ data, onOpen }) {
  const [wrap, size] = useSize()
  const ref = useRef(null)
  useEffect(() => {
    if (!data || !size.width) return
    const { width, height } = size
    const m = { t: 14, r: 16, b: 30, l: 40 }
    const svg = d3.select(ref.current).attr('width', width).attr('height', height)
    svg.selectAll('*').remove()
    const fglow = glow(svg, 'rmGlow', 2.5)
    const x = d3.scaleLinear().domain([-0.04, 1.06]).range([m.l, width - m.r])
    const y = d3.scaleLinear().domain([0.5, 5.3]).range([height - m.b, m.t])
    const r = d3.scaleSqrt().domain([0, d3.max(data, (d) => d.est_mttr_h) || 3]).range([4, 13])
    const defs = svg.select('defs')
    const hot = defs.append('linearGradient').attr('id', 'rmHot').attr('x1', 0).attr('x2', 1).attr('y1', 1).attr('y2', 0)
    hot.append('stop').attr('offset', '0%').attr('stop-color', C.crit).attr('stop-opacity', 0)
    hot.append('stop').attr('offset', '100%').attr('stop-color', C.crit).attr('stop-opacity', 0.16)
    svg.append('rect').attr('x', x(0.5)).attr('y', y(5.3)).attr('width', x(1.06) - x(0.5)).attr('height', y(3) - y(5.3)).attr('fill', 'url(#rmHot)').attr('rx', 8)
    const zones = [[0.55, 5.05, 'ACT NOW', C.crit], [0.55, 0.62, 'SCHEDULE', C.warn], [0.1, 5.05, 'MONITOR', C.watch], [0.1, 0.62, 'WATCH', C.dim]]
    zones.forEach(([zx, zy, t, c]) => svg.append('text').attr('x', x(zx)).attr('y', y(zy)).attr('fill', c).attr('opacity', 0.55).style('font', '700 10px Inter').style('letter-spacing', '.14em').text(t))
    svg.append('line').attr('x1', x(0.5)).attr('x2', x(0.5)).attr('y1', m.t).attr('y2', height - m.b).attr('stroke', C.line2).attr('stroke-dasharray', '3 4')
    svg.append('line').attr('x1', m.l).attr('x2', width - m.r).attr('y1', y(3)).attr('y2', y(3)).attr('stroke', C.line2).attr('stroke-dasharray', '3 4')
    svg.append('g').attr('transform', `translate(0,${height - m.b})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('.0%')).tickSize(0).tickPadding(8))
      .call((g) => { g.select('.domain').attr('stroke', C.line2); g.selectAll('text').attr('fill', C.dim).style('font', '9px JetBrains Mono') })
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(6))
      .call((g) => { g.select('.domain').attr('stroke', C.line2); g.selectAll('text').attr('fill', C.dim).style('font', '9px JetBrains Mono') })
    svg.append('text').attr('x', width - m.r).attr('y', height - 4).attr('text-anchor', 'end').attr('fill', C.muted).style('font', '9.5px Inter').text('72-hour failure risk →')
    svg.append('text').attr('transform', `translate(11,${m.t}) rotate(-90)`).attr('text-anchor', 'end').attr('fill', C.muted).style('font', '9.5px Inter').text('operational criticality →')

    const nodes = data.map((d) => ({ ...d, tx: x(d.risk_score), ty: y(d.crit_score), rr: r(d.est_mttr_h || 1) }))
    const sim = d3.forceSimulation(nodes)
      .force('x', d3.forceX((d) => d.tx).strength(0.9))
      .force('y', d3.forceY((d) => d.ty).strength(0.25))
      .force('c', d3.forceCollide((d) => d.rr + 1.2))
      .stop()
    for (let i = 0; i < 220; i++) sim.tick()
    nodes.forEach((d) => {
      d.x = Math.max(m.l + d.rr, Math.min(width - m.r - d.rr, d.x))
      d.y = Math.max(m.t + d.rr, Math.min(height - m.b - d.rr, d.y))
    })
    const g = svg.append('g')
    g.selectAll('circle').data(nodes.sort((a, b) => a.priority_score - b.priority_score)).join('circle')
      .attr('data-asset', (d) => d.asset_id).attr('cx', (d) => d.x).attr('cy', (d) => d.y).attr('r', (d) => d.rr)
      .attr('fill', (d) => COMP_COLOR[d.component]).attr('fill-opacity', (d) => (d.tier === 'watch' ? 0.35 : 0.72))
      .attr('stroke', (d) => (d.tier !== 'watch' && (d.part_status === 'stockout_risk' || d.part_status === 'reorder') ? STOCK_COLOR[d.part_status] : '#0b1222'))
      .attr('stroke-width', (d) => (d.tier === 'watch' ? 0.8 : d.part_status === 'stockout_risk' ? 2.4 : d.part_status === 'reorder' ? 1.8 : 1))
      .attr('stroke-dasharray', (d) => (d.tier !== 'watch' && d.part_status === 'reorder' ? '3 2' : null))
      .attr('filter', (d) => (d.tier === 'critical' && d.crit_score >= 3 ? fglow : null))
      .style('cursor', 'pointer')
      .on('mouseenter', (e, d) => tip.show(`<div class="h">${d.asset_id}</div>${d.workload} · ${d.vendor}<br/>
          <span class="k">risk</span> <b style="color:${TIER_COLOR[d.tier]}">${(d.risk_score * 100).toFixed(1)}%</b> · <span class="k">anomaly z</span> ${d.anomaly_z}<br/>
          <span class="k">criticality</span> ${d.crit_score} ${d.state !== 'normal' ? `(${STATE_LABEL[d.state]})` : ''}<br/>
          <span class="k">part</span> ${d.sku || '—'} <b style="color:${STOCK_COLOR[d.part_status] || C.muted}">${STOCK_LABEL[d.part_status] || ''}</b> · ${d.on_hand ?? '—'} on hand<br/>
          <span class="k">est. work</span> ${d.est_mttr_h?.toFixed(1)} h · priority <b>${d.priority_score}</b>`, e))
      .on('mousemove', (e) => tip.move(e)).on('mouseleave', () => tip.hide())
      .on('click', (e, d) => onOpen && onOpen(d.asset_id))
    nodes.filter((d) => d.priority_score >= d3.quantile(nodes.map((n) => n.priority_score).sort(d3.ascending), 0.96))
      .forEach((d) => g.append('text').attr('x', d.x - d.rr - 4).attr('text-anchor', 'end').attr('y', d.y + 3).attr('fill', C.text).style('font', '9px JetBrains Mono').style('pointer-events', 'none').text(d.server_id))
  }, [data, size, onOpen])
  return (
    <div ref={wrap} className="chart">
      <svg ref={ref} />
    </div>
  )
}

/* Expected failures in the next 72 h vs spares on hand, per component. */
export function ForecastBars({ data }) {
  const [wrap, size] = useSize()
  const ref = useRef(null)
  useEffect(() => {
    if (!data || !size.width) return
    const { width, height } = size
    const m = { t: 8, r: 70, b: 8, l: 48 }
    const svg = d3.select(ref.current).attr('width', width).attr('height', height)
    svg.selectAll('*').remove()
    const yb = d3.scaleBand().domain(data.map((d) => d.component)).range([m.t, height - m.b]).padding(0.38)
    const x = d3.scaleLinear().domain([0, d3.max(data, (d) => Math.max(d.expected_failures_72h, d.spares_on_hand)) * 1.1 || 1]).range([m.l, width - m.r])
    data.forEach((d) => {
      const y = yb(d.component)
      const h = yb.bandwidth()
      svg.append('text').attr('x', m.l - 8).attr('y', y + h / 2 + 4).attr('text-anchor', 'end').attr('fill', COMP_COLOR[d.component]).style('font', '600 11px JetBrains Mono').text(COMP_LABEL[d.component])
      svg.append('rect').attr('x', m.l).attr('y', y).attr('width', x.range()[1] - m.l).attr('height', h).attr('rx', 4).attr('fill', '#0f1830')
      svg.append('rect').attr('x', m.l).attr('y', y).attr('height', h).attr('rx', 4).attr('fill', COMP_COLOR[d.component]).attr('opacity', 0.8)
        .attr('width', 0).transition().duration(800).attr('width', x(d.expected_failures_72h) - m.l)
      const sx = x(d.spares_on_hand)
      svg.append('path').attr('d', d3.symbol(d3.symbolDiamond, 70)()).attr('transform', `translate(${sx},${y + h / 2})`)
        .attr('fill', d.spares_on_hand < d.expected_failures_72h ? C.crit : '#fff')
      svg.append('text').attr('x', width - m.r + 8).attr('y', y + h / 2 - 2).attr('fill', C.text).style('font', '600 11px JetBrains Mono').text(`${d.expected_failures_72h.toFixed(1)}`)
      svg.append('text').attr('x', width - m.r + 8).attr('y', y + h / 2 + 10).attr('fill', d.skus_short ? C.warn : C.dim).style('font', '9px Inter')
        .text(`${d.spares_on_hand} spares${d.skus_short ? ` · ${d.skus_short} short` : ''}`)
      svg.append('rect').attr('x', m.l).attr('y', y).attr('width', x.range()[1] - m.l).attr('height', h).attr('fill', 'transparent')
        .on('mouseenter', (e) => tip.show(`<div class="h">${COMP_LABEL[d.component]}</div><span class="k">expected failures (72h, Σ risk)</span> <b>${d.expected_failures_72h}</b><br/><span class="k">alerts ≥50%</span> ${d.alerts} · <span class="k">watch</span> ${d.watch}<br/><span class="k">spares on hand (matching SKUs)</span> ${d.spares_on_hand}<br/><span class="k">incidents, 12 months</span> ${d.incidents_12m}`, e))
        .on('mousemove', (e) => tip.move(e)).on('mouseleave', () => tip.hide())
    })
  }, [data, size])
  return (
    <div ref={wrap} className="chart">
      <svg ref={ref} />
    </div>
  )
}
