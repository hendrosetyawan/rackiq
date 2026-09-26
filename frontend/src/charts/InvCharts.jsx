import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { C, STOCK_COLOR, STOCK_LABEL, glow } from '../lib/theme.js'
import { tip, useSize } from '../lib/ui.js'

/* Stock runway (bullet chart per SKU): band = reorder zone, bar = on hand,
   ghost = on hand + inbound, ◆ = ML-predicted near-term demand, ▲ = predicted +
   30-day baseline demand, right = days of cover. */
export function StockRunway({ data, selected, onSelect }) {
  const [wrap, size] = useSize()
  const ref = useRef(null)
  useEffect(() => {
    if (!data || !size.width) return
    const width = size.width
    const rowH = 27
    const m = { t: 18, r: 92, l: 150 }
    const height = m.t + rowH * data.length + 4
    const svg = d3.select(ref.current).attr('width', width).attr('height', height)
    svg.selectAll('*').remove()
    const fglow = glow(svg, 'srGlow', 2)
    const max = d3.max(data, (d) => Math.max(d.on_hand + d.inbound_qty, d.reorder_point, d.ml_demand + d.baseline_30d)) * 1.08
    const x = d3.scaleLinear().domain([0, max]).range([m.l, width - m.r])
    svg.append('g').attr('transform', `translate(0,${m.t - 4})`).call(d3.axisTop(x).ticks(6).tickSize(-(height - m.t)).tickPadding(4))
      .call((g) => { g.select('.domain').remove(); g.selectAll('line').attr('stroke', C.line).attr('stroke-dasharray', '1 4'); g.selectAll('text').attr('fill', C.dim).style('font', '8.5px JetBrains Mono') })
    svg.append('text').attr('x', width - 4).attr('y', 10).attr('text-anchor', 'end').attr('fill', C.dim).style('font', '600 8.5px Inter').text('COVER · TURNS')
    data.forEach((d, i) => {
      const y = m.t + i * rowH
      const g = svg.append('g').attr('data-sku', d.sku).attr('transform', `translate(0,${y})`).style('cursor', 'pointer').on('click', () => onSelect && onSelect(d.sku))
      if (d.sku === selected) g.append('rect').attr('x', 0).attr('y', 0).attr('width', width).attr('height', rowH - 2).attr('rx', 5).attr('fill', 'rgba(34,211,238,.07)').attr('stroke', 'rgba(34,211,238,.35)')
      g.append('circle').attr('cx', 8).attr('cy', rowH / 2 - 1).attr('r', 3).attr('fill', STOCK_COLOR[d.status]).attr('filter', d.status === 'stockout_risk' ? fglow : null)
      g.append('text').attr('x', 17).attr('y', 11).attr('fill', C.text).style('font', '600 10px JetBrains Mono').text(d.sku)
      g.append('text').attr('x', 17).attr('y', 21).attr('fill', C.dim).style('font', '8.5px Inter').text(d.desc.slice(0, 28))
      g.append('rect').attr('x', x(0)).attr('y', 5).attr('width', x(d.reorder_point) - x(0)).attr('height', rowH - 12).attr('fill', 'rgba(239,68,68,.12)')
      g.append('rect').attr('x', x(0)).attr('y', 5).attr('width', x(max) - x(0)).attr('height', rowH - 12).attr('fill', 'none').attr('stroke', C.line)
      if (d.inbound_qty) g.append('rect').attr('x', x(0)).attr('y', 8).attr('width', x(d.on_hand + d.inbound_qty) - x(0)).attr('height', rowH - 18).attr('fill', 'none').attr('stroke', STOCK_COLOR[d.status]).attr('stroke-dasharray', '3 2')
      g.append('rect').attr('x', x(0)).attr('y', 8).attr('height', rowH - 18).attr('rx', 2).attr('fill', STOCK_COLOR[d.status]).attr('opacity', 0.85)
        .attr('width', 0).transition().duration(700).delay(i * 25).attr('width', x(d.on_hand) - x(0))
      g.append('path').attr('d', d3.symbol(d3.symbolTriangle, 34)()).attr('transform', `translate(${x(d.ml_demand + d.baseline_30d)},${rowH - 6}) rotate(180)`).attr('fill', C.muted)
      if (d.ml_demand > 0) g.append('path').attr('d', d3.symbol(d3.symbolDiamond, 48)()).attr('transform', `translate(${x(d.ml_demand)},${rowH / 2 - 1})`).attr('fill', C.pink).attr('filter', fglow)
      g.append('text').attr('x', width - m.r + 10).attr('y', 12).attr('fill', d.days_of_cover < d.lead_time_days ? C.crit : C.text).style('font', '600 10.5px JetBrains Mono').text(`${Math.round(d.days_of_cover)}d`)
      g.append('text').attr('x', width - m.r + 10).attr('y', 22).attr('fill', C.dim).style('font', '8.5px JetBrains Mono').text(`${d.turns.toFixed(1)}× · LT ${d.lead_time_days}d`)
      g.on('mouseenter', (e) => tip.show(`<div class="h">${d.sku}</div>${d.desc}<br/>
          <b style="color:${STOCK_COLOR[d.status]}">${STOCK_LABEL[d.status]}</b> · bin ${d.bin}<br/>
          <span class="k">on hand</span> ${d.on_hand} · <span class="k">inbound</span> ${d.inbound_qty}${d.next_arrival ? ` (ETA ${d.next_arrival})` : ''} · <span class="k">reorder pt</span> ${d.reorder_point}<br/>
          <span style="color:${C.pink}">◆ predicted near-term</span> ${d.ml_demand.toFixed(1)} (${d.n_at_risk} assets ≥50%) · <span class="k">▲ +30d baseline</span> ${(d.ml_demand + d.baseline_30d).toFixed(1)}<br/>
          <span class="k">issued 12m</span> ${d.issued_12m} · <span class="k">turns</span> ${d.turns.toFixed(1)}× · <span class="k">turn cycle</span> ${Math.round(d.turn_cycle_days)} d · <span class="k">stockout days</span> ${d.stockout_days_12m}`, e))
        .on('mousemove', (e) => tip.move(e)).on('mouseleave', () => tip.hide())
    })
  }, [data, size, selected, onSelect])
  return (
    <div ref={wrap} style={{ width: '100%' }}>
      <svg ref={ref} />
    </div>
  )
}

/* Turnover vs cover: x = inventory turns / yr, y = days of cover (log), size = stock value, color = status. */
export function TurnoverBubbles({ data, selected, onSelect }) {
  const [wrap, size] = useSize()
  const ref = useRef(null)
  useEffect(() => {
    if (!data || !size.width) return
    const { width, height } = size
    const m = { t: 12, r: 16, b: 26, l: 40 }
    const svg = d3.select(ref.current).attr('width', width).attr('height', height)
    svg.selectAll('*').remove()
    const fglow = glow(svg, 'tbGlow', 2.5)
    const x = d3.scaleLinear().domain([0, d3.max(data, (d) => d.turns) * 1.12]).range([m.l, width - m.r])
    const y = d3.scaleLog().domain([Math.max(3, d3.min(data, (d) => d.days_of_cover) * 0.7), d3.max(data, (d) => d.days_of_cover) * 1.4]).range([height - m.b, m.t])
    const r = d3.scaleSqrt().domain([0, d3.max(data, (d) => d.value_usd)]).range([4, 20])
    svg.append('rect').attr('x', x(d3.median(data, (d) => d.turns))).attr('y', y(30)).attr('width', x.range()[1] - x(d3.median(data, (d) => d.turns))).attr('height', y.range()[0] - y(30))
      .attr('fill', 'rgba(239,68,68,.08)')
    svg.append('text').attr('x', width - m.r - 4).attr('y', height - m.b - 6).attr('text-anchor', 'end').attr('fill', C.crit).attr('opacity', 0.7).style('font', '700 9px Inter').style('letter-spacing', '.12em').text('FAST MOVER · THIN COVER')
    svg.append('g').attr('transform', `translate(0,${height - m.b})`).call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(6))
      .call((g) => { g.select('.domain').attr('stroke', C.line2); g.selectAll('text').attr('fill', C.dim).style('font', '9px JetBrains Mono') })
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4, '~s').tickSize(0).tickPadding(6))
      .call((g) => { g.select('.domain').attr('stroke', C.line2); g.selectAll('text').attr('fill', C.dim).style('font', '9px JetBrains Mono') })
    svg.append('text').attr('x', width - m.r).attr('y', height - 3).attr('text-anchor', 'end').attr('fill', C.muted).style('font', '9px Inter').text('inventory turns / year →')
    svg.append('text').attr('transform', `translate(10,${m.t}) rotate(-90)`).attr('text-anchor', 'end').attr('fill', C.muted).style('font', '9px Inter').text('days of cover (log) →')
    const nodes = [...data].sort((a, b) => b.value_usd - a.value_usd)
    nodes.forEach((d) => {
      const g = svg.append('g').style('cursor', 'pointer').on('click', () => onSelect && onSelect(d.sku))
        .on('mouseenter', (e) => tip.show(`<div class="h">${d.sku}</div>${d.turns.toFixed(1)} turns/yr · ${Math.round(d.days_of_cover)} days cover<br/>$${Math.round(d.value_usd).toLocaleString()} on hand · <b style="color:${STOCK_COLOR[d.status]}">${STOCK_LABEL[d.status]}</b>`, e))
        .on('mousemove', (e) => tip.move(e)).on('mouseleave', () => tip.hide())
      g.append('circle').attr('cx', x(d.turns)).attr('cy', y(Math.max(d.days_of_cover, y.domain()[0]))).attr('r', r(d.value_usd))
        .attr('fill', STOCK_COLOR[d.status]).attr('fill-opacity', 0.28).attr('stroke', STOCK_COLOR[d.status]).attr('stroke-width', d.sku === selected ? 2.5 : 1.2)
        .attr('filter', d.sku === selected ? fglow : null)
      g.append('text').attr('x', x(d.turns)).attr('y', y(Math.max(d.days_of_cover, y.domain()[0])) - r(d.value_usd) - 3).attr('text-anchor', 'middle')
        .attr('fill', C.muted).style('font', '8px JetBrains Mono').text(d.sku.split('-').slice(0, 2).join('-'))
    })
  }, [data, size, selected, onSelect])
  return (
    <div ref={wrap} className="chart">
      <svg ref={ref} />
    </div>
  )
}

/* Stock level history for one SKU: step area, reorder point, receipts ▲, backorders ✕, issue ticks. */
export function StockHistory({ hist, sku }) {
  const [wrap, size] = useSize()
  const ref = useRef(null)
  useEffect(() => {
    if (!hist || !sku || !size.width) return
    const h = hist
    const { width, height } = size
    const m = { t: 10, r: 10, b: 22, l: 28 }
    const svg = d3.select(ref.current).attr('width', width).attr('height', height)
    svg.selectAll('*').remove()
    const rows = h.date.map((d, i) => ({ t: new Date(d), on_hand: h.on_hand[i], on_order: h.on_order[i], date: d }))
    const x = d3.scaleTime().domain(d3.extent(rows, (d) => d.t)).range([m.l, width - m.r])
    const y = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.on_hand + d.on_order) * 1.1 || 1]).nice().range([height - m.b - 10, m.t])
    const id = `shg${sku.replace(/[^A-Z0-9]/gi, '')}`
    const lg = svg.append('defs').append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1)
    lg.append('stop').attr('offset', '0%').attr('stop-color', C.cyan).attr('stop-opacity', 0.4)
    lg.append('stop').attr('offset', '100%').attr('stop-color', C.cyan).attr('stop-opacity', 0.02)
    svg.append('g').attr('transform', `translate(0,${height - m.b})`).call(d3.axisBottom(x).ticks(6).tickSize(0).tickPadding(6))
      .call((g) => { g.select('.domain').remove(); g.selectAll('text').attr('fill', C.dim).style('font', '9px JetBrains Mono') })
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(width - m.l - m.r)))
      .call((g) => { g.select('.domain').remove(); g.selectAll('line').attr('stroke', C.line).attr('stroke-dasharray', '2 4'); g.selectAll('text').attr('fill', C.dim).style('font', '9px JetBrains Mono') })
    svg.append('path').datum(rows).attr('fill', `url(#${id})`).attr('d', d3.area().x((d) => x(d.t)).y0(y(0)).y1((d) => y(d.on_hand)).curve(d3.curveStepAfter))
    svg.append('path').datum(rows).attr('fill', 'none').attr('stroke', C.cyan).attr('stroke-width', 1.4).attr('d', d3.line().x((d) => x(d.t)).y((d) => y(d.on_hand)).curve(d3.curveStepAfter))
    svg.append('path').datum(rows).attr('fill', 'none').attr('stroke', C.violet).attr('stroke-dasharray', '3 3').attr('d', d3.line().x((d) => x(d.t)).y((d) => y(d.on_hand + d.on_order)).curve(d3.curveStepAfter))
    const issues = Object.entries(h.issues_by_day || {})
    issues.forEach(([d, q]) => svg.append('line').attr('x1', x(new Date(d))).attr('x2', x(new Date(d))).attr('y1', height - m.b - 8).attr('y2', height - m.b - 8 - Math.min(q * 3, 9)).attr('stroke', C.pink).attr('stroke-width', 1.2))
    h.events.forEach((e) => {
      const ex = x(new Date(e.date))
      if (e.type === 'receipt') svg.append('path').attr('d', d3.symbol(d3.symbolTriangle, 30)()).attr('transform', `translate(${ex},${m.t + 4})`).attr('fill', C.ok)
      if (e.type === 'backorder') svg.append('path').attr('d', d3.symbol(d3.symbolCross, 40)()).attr('transform', `translate(${ex},${y(0) - 4}) rotate(45)`).attr('fill', C.crit)
    })
    const hover = svg.append('line').attr('y1', m.t).attr('y2', height - m.b).attr('stroke', C.muted).attr('stroke-dasharray', '2 3').attr('opacity', 0)
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', width - m.l - m.r).attr('height', height - m.t - m.b).attr('fill', 'transparent')
      .on('mousemove', (e) => {
        const [mx] = d3.pointer(e)
        const d = rows[d3.bisector((r) => r.t).center(rows, x.invert(mx))]
        hover.attr('x1', x(d.t)).attr('x2', x(d.t)).attr('opacity', 1)
        tip.show(`<div class="h">${sku} · ${d.date}</div><span style="color:${C.cyan}">on hand</span> ${d.on_hand} · <span style="color:${C.violet}">on order</span> ${d.on_order}${h.issues_by_day[d.date] ? `<br/><span style="color:${C.pink}">issued</span> ${h.issues_by_day[d.date]}` : ''}`, e)
      })
      .on('mouseleave', () => { hover.attr('opacity', 0); tip.hide() })
  }, [hist, sku, size])
  return (
    <div ref={wrap} className="chart">
      <svg ref={ref} />
    </div>
  )
}
