import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { C, COMPONENTS, COMP_LABEL, TIER_COLOR, glow, thermal } from '../lib/theme.js'
import { tip } from '../lib/ui.js'

/** Front elevation of one rack: 8 servers x 5 monitored components, plus inlet & power. */
export default function RackElevation({ rack, onOpen }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!rack) return
    const width = 330
    const rowH = 33
    const top = 20
    const height = top + rowH * 8 + 4
    const svg = d3.select(ref.current).attr('viewBox', `0 0 ${width} ${height}`)
    svg.selectAll('*').remove()
    const fglow = glow(svg, 'reGlow', 2)
    const cellX = (i) => 70 + i * 36
    COMPONENTS.forEach((c, i) =>
      svg.append('text').attr('x', cellX(i) + 15).attr('y', 11).attr('text-anchor', 'middle').attr('fill', C.dim)
        .style('font', '600 8.5px Inter').style('letter-spacing', '.08em').text(COMP_LABEL[c].toUpperCase()),
    )
    svg.append('text').attr('x', 262).attr('y', 11).attr('fill', C.dim).style('font', '600 8.5px Inter').text('INLET')
    svg.append('text').attr('x', 304).attr('y', 11).attr('fill', C.dim).style('font', '600 8.5px Inter').text('kW')
    const maxP = d3.max(rack.slots, (s) => s.power_w) || 1

    ;[...rack.slots].sort((a, b) => b.slot - a.slot).forEach((s, k) => {
      const y = top + k * rowH
      const g = svg.append('g').attr('transform', `translate(0,${y})`)
      g.append('rect').attr('x', 0).attr('y', 0).attr('width', width).attr('height', rowH - 4).attr('rx', 5)
        .attr('fill', s.status === 'healthy' ? '#0b1427' : `${TIER_COLOR[s.status]}14`)
        .attr('stroke', s.status === 'healthy' ? '#17233f' : `${TIER_COLOR[s.status]}66`)
      g.append('circle').attr('cx', 9).attr('cy', (rowH - 4) / 2).attr('r', 3).attr('fill', TIER_COLOR[s.status])
        .attr('filter', fglow).attr('class', s.status === 'critical' ? 'pulse' : null)
      g.append('text').attr('x', 18).attr('y', 12).attr('fill', C.text).style('font', '600 10.5px JetBrains Mono').text(`S${s.slot}`)
      g.append('text').attr('x', 18).attr('y', 23).attr('fill', C.dim).style('font', '8px Inter')
        .text(s.model.replace('PowerEdge ', 'PE ').replace('ProLiant ', '').replace('ThinkSystem ', ''))
      COMPONENTS.forEach((c, i) => {
        const t = s.tiers[c]
        const r = s.comps[c]
        const cg = g.append('g').attr('transform', `translate(${cellX(i)},4)`).style('cursor', 'pointer')
          .on('click', () => onOpen && onOpen(`${s.server_id}-${c.toUpperCase()}`))
          .on('mouseenter', (e) => tip.show(`<div class="h">${s.server_id}-${c.toUpperCase()}</div>72h failure risk <b style="color:${TIER_COLOR[t]}">${(r * 100).toFixed(1)}%</b><div class="k">click for cited recommendation</div>`, e))
          .on('mousemove', (e) => tip.move(e)).on('mouseleave', () => tip.hide())
        cg.append('rect').attr('width', 30).attr('height', rowH - 12).attr('rx', 4)
          .attr('fill', t === 'healthy' ? '#0e2b27' : TIER_COLOR[t]).attr('fill-opacity', t === 'healthy' ? 1 : 0.85)
          .attr('stroke', t === 'healthy' ? '#15443b' : TIER_COLOR[t]).attr('filter', t === 'critical' ? fglow : null)
        cg.append('text').attr('x', 15).attr('y', (rowH - 12) / 2 + 3.5).attr('text-anchor', 'middle')
          .attr('fill', t === 'healthy' ? '#3f8f7c' : '#0b1020').style('font', '600 9px JetBrains Mono')
          .text(r >= 0.01 ? `${Math.round(r * 100)}` : '·')
      })
      g.append('rect').attr('x', 254).attr('y', 9).attr('width', 40).attr('height', 11).attr('rx', 3).attr('fill', thermal(s.inlet)).attr('opacity', 0.9)
      g.append('text').attr('x', 274).attr('y', 17.5).attr('text-anchor', 'middle').attr('fill', '#07101f').style('font', '600 8.5px JetBrains Mono').text(s.inlet.toFixed(1))
      g.append('rect').attr('x', 300).attr('y', 20).attr('width', 26).attr('height', 3).attr('rx', 1.5).attr('fill', '#16223b')
      g.append('rect').attr('x', 300).attr('y', 20).attr('width', 26 * (s.power_w / maxP)).attr('height', 3).attr('rx', 1.5).attr('fill', C.cyan)
      g.append('text').attr('x', 313).attr('y', 15).attr('text-anchor', 'middle').attr('fill', C.muted).style('font', '8.5px JetBrains Mono').text((s.power_w / 1000).toFixed(2))
    })
  }, [rack, onOpen])
  return <svg ref={ref} style={{ width: '100%', display: 'block' }} />
}
