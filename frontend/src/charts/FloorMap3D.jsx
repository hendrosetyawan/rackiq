import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { C, COMPONENTS, COMP_LABEL, STATE_COLOR, STATE_LABEL, TIER_COLOR, TIER_LABEL, glow, powerColor, thermal } from '../lib/theme.js'
import { esc, tip } from '../lib/ui.js'

// Oblique ("cabinet") projection: every rack is a 3D box whose front face stays
// undistorted so all 8 server slots remain legible.
const W = 34, H = 80, GAP = 6, DX = 12, DY = 9, AISLE = 40, LEFT = 50, TOP = 28
const SLOT_H = (H - 10) / 8

const HEALTH_FILL = { healthy: '#0f3a33', watch: C.watch, warning: C.warn, critical: C.crit }

function slotHtml(rack, s) {
  const comps = COMPONENTS.map(
    (c) => `<tr><td class="k">${COMP_LABEL[c]}</td><td style="color:${TIER_COLOR[s.tiers[c]]}">${(s.comps[c] * 100).toFixed(1)}%</td></tr>`,
  ).join('')
  return `<div class="h">${esc(s.server_id)}</div>
    <div>${esc(s.model)} · ${esc(s.workload)}</div>
    <div style="margin:4px 0"><b style="color:${TIER_COLOR[s.status]}">${TIER_LABEL[s.status]}</b>
    <span class="k"> · health ${s.health ?? '—'} · ${s.inlet}°C inlet · ${Math.round(s.power_w)} W · CPU ${s.cpu}%</span></div>
    <table>${comps}</table>
    ${rack.state !== 'normal' ? `<div style="margin-top:4px;color:${STATE_COLOR[rack.state]}">● ${STATE_LABEL[rack.state]}</div>` : ''}`
}

export default function FloorMap3D({ floor, mode = 'health', selected, onSelect }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!floor) return
    const rows = floor.rows
    const n = floor.racks_per_row
    const shift = (ri) => (rows.length - 1 - ri) * 8
    const rx = (pos, ri) => LEFT + shift(ri) + (pos - 1) * (W + GAP)
    const ry = (ri) => TOP + ri * (H + AISLE)
    const vbW = LEFT + shift(0) + n * (W + GAP) + DX + 10
    const vbH = TOP + rows.length * (H + AISLE) - AISLE + 26

    const svg = d3.select(ref.current).attr('viewBox', `0 0 ${vbW} ${vbH}`).attr('preserveAspectRatio', 'xMidYMid meet')
    svg.selectAll('*').remove()
    const defs = svg.append('defs')
    const fglow = glow(svg, 'fmGlow', 2.2)
    const bglow = glow(svg, 'fmBeacon', 3.5)
    const aisle = defs.append('linearGradient').attr('id', 'fmAisle').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1)
    aisle.append('stop').attr('offset', '0%').attr('stop-color', C.cyan).attr('stop-opacity', 0.0)
    aisle.append('stop').attr('offset', '50%').attr('stop-color', C.cyan).attr('stop-opacity', 0.07)
    aisle.append('stop').attr('offset', '100%').attr('stop-color', C.cyan).attr('stop-opacity', 0.0)
    const pat = defs.append('pattern').attr('id', 'fmPerf').attr('width', 7).attr('height', 7).attr('patternUnits', 'userSpaceOnUse')
    pat.append('circle').attr('cx', 3.5).attr('cy', 3.5).attr('r', 0.7).attr('fill', C.cyan).attr('opacity', 0.25)
    const hot = defs.append('radialGradient').attr('id', 'fmHot')
    hot.append('stop').attr('offset', '0%').attr('stop-color', C.crit).attr('stop-opacity', 0.55)
    hot.append('stop').attr('offset', '100%').attr('stop-color', C.crit).attr('stop-opacity', 0)
    const sheen = defs.append('linearGradient').attr('id', 'fmSheen').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1)
    sheen.append('stop').attr('offset', '0%').attr('stop-color', '#fff').attr('stop-opacity', 0.16)
    sheen.append('stop').attr('offset', '100%').attr('stop-color', '#fff').attr('stop-opacity', 0)

    const maxP = d3.max(floor.racks, (r) => d3.max(r.slots, (s) => s.power_w)) || 1
    const pScale = d3.scaleSqrt().domain([0, maxP]).range([0, 1])
    const slotFill = (s) =>
      mode === 'thermal' ? thermal(s.inlet) : mode === 'power' ? powerColor(pScale(s.power_w)) : HEALTH_FILL[s.status]

    // floor plane
    svg.append('polygon')
      .attr('points', [[LEFT - 30, TOP - 14], [vbW - 4, TOP - 14], [vbW - 4, vbH - 4], [LEFT - 30, vbH - 4]].join(' '))
      .attr('fill', 'rgba(15,24,44,0.35)').attr('stroke', C.line)

    rows.forEach((row, ri) => {
      const y = ry(ri)
      // cold aisle in front of the row
      if (ri < rows.length - 1) {
        svg.append('rect').attr('x', LEFT - 22).attr('y', y + H + 9).attr('width', vbW - LEFT + 14).attr('height', AISLE - 18)
          .attr('fill', 'url(#fmAisle)')
        svg.append('rect').attr('x', LEFT - 22).attr('y', y + H + 12).attr('width', vbW - LEFT + 14).attr('height', AISLE - 24)
          .attr('fill', 'url(#fmPerf)').attr('opacity', 0.6)
      }
      // row badge
      const bx = 20
      svg.append('rect').attr('x', bx - 11).attr('y', y + H / 2 - 11).attr('width', 22).attr('height', 22).attr('rx', 6)
        .attr('fill', '#0d1730').attr('stroke', C.line2)
      svg.append('text').attr('x', bx).attr('y', y + H / 2 + 4).attr('text-anchor', 'middle').attr('fill', C.text)
        .style('font', '600 12px JetBrains Mono').text(row)
      const wl = floor.racks.find((r) => r.row === row)?.workload
      svg.append('text').attr('x', bx).attr('y', y + H / 2 + 22).attr('text-anchor', 'middle').attr('fill', C.dim)
        .style('font', '7.5px Inter').text(wl === 'virtualization' ? 'virt' : wl)

      const racks = floor.racks.filter((r) => r.row === row).sort((a, b) => a.pos - b.pos)
      racks.forEach((rack) => {
        const g = svg.append('g').attr('data-rack', rack.rack_id).attr('transform', `translate(${rx(rack.pos, ri)},${y})`).style('cursor', 'pointer')
          .on('click', () => onSelect && onSelect(rack.rack_id))
        if (rack.n_crit > 0) g.append('ellipse').attr('cx', W / 2 + DX / 2).attr('cy', H + 2).attr('rx', W * 0.9).attr('ry', 7).attr('fill', 'url(#fmHot)')
        // side + top faces
        g.append('polygon').attr('points', [[W, 0], [W + DX, -DY], [W + DX, H - DY], [W, H]].join(' ')).attr('fill', '#080e1c').attr('stroke', '#1b2a47')
        const topFill = mode === 'thermal' ? thermal(rack.max_inlet) : '#17233f'
        g.append('polygon').attr('points', [[0, 0], [DX, -DY], [W + DX, -DY], [W, 0]].join(' '))
          .attr('fill', topFill).attr('fill-opacity', mode === 'thermal' ? 0.85 : 1).attr('stroke', '#2a3c64')
        // front face
        const sel = rack.rack_id === selected
        g.append('rect').attr('width', W).attr('height', H).attr('rx', 1.5).attr('fill', '#0c1426')
          .attr('stroke', sel ? C.cyan : '#26375a').attr('stroke-width', sel ? 1.8 : 1).attr('filter', sel ? fglow : null)
        rack.slots.forEach((s) => {
          const sy = 6 + (8 - s.slot) * SLOT_H
          const sg = g.append('g')
          sg.append('rect').attr('x', 3).attr('y', sy).attr('width', W - 10).attr('height', SLOT_H - 1.6).attr('rx', 1)
            .attr('fill', slotFill(s)).attr('opacity', mode === 'health' && s.status === 'healthy' ? 1 : 0.92)
          sg.append('rect').attr('x', 3).attr('y', sy).attr('width', W - 10).attr('height', (SLOT_H - 1.6) / 2).attr('fill', 'url(#fmSheen)')
          sg.append('circle').attr('cx', W - 4).attr('cy', sy + (SLOT_H - 1.6) / 2).attr('r', 1.7)
            .attr('fill', TIER_COLOR[s.status]).attr('class', s.status === 'critical' ? 'pulse' : null)
            .attr('filter', s.status !== 'healthy' ? fglow : null)
          sg.append('rect').attr('data-slot', s.server_id).attr('x', 1).attr('y', sy - 0.6).attr('width', W - 2).attr('height', SLOT_H).attr('fill', 'transparent')
            .on('mouseenter', (e) => tip.show(slotHtml(rack, s), e))
            .on('mousemove', (e) => tip.move(e))
            .on('mouseleave', () => tip.hide())
        })
        if (rack.state !== 'normal') {
          const cx = W / 2 + DX / 2
          g.append('circle').attr('cx', cx).attr('cy', -DY / 2).attr('r', 6).attr('fill', STATE_COLOR[rack.state]).attr('opacity', 0.18)
          g.append('circle').attr('cx', cx).attr('cy', -DY / 2).attr('r', 2.8).attr('fill', STATE_COLOR[rack.state]).attr('filter', bglow)
        }
        if (ri === rows.length - 1)
          svg.append('text').attr('x', rx(rack.pos, ri) + W / 2).attr('y', y + H + 14).attr('text-anchor', 'middle')
            .attr('fill', C.dim).style('font', '8px JetBrains Mono').text(String(rack.pos).padStart(2, '0'))
      })
    })
  }, [floor, mode, selected, onSelect])
  return <svg ref={ref} style={{ width: '100%', height: '100%' }} />
}
