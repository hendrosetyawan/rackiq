import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { C, glow, nextId } from '../lib/theme.js'

/** Futuristic 270-degree radial gauge with threshold bands and a glowing value arc. */
export function Gauge({ value, min = 0, max = 100, size = 88, color = C.cyan, bands = [], fmt = (v) => v, unit = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const svg = d3.select(ref.current)
    svg.selectAll('*').remove()
    const r = size / 2 - 6
    const a0 = -0.75 * Math.PI
    const a1 = 0.75 * Math.PI
    const scale = d3.scaleLinear().domain([min, max]).range([a0, a1]).clamp(true)
    const g = svg.attr('width', size).attr('height', size).append('g').attr('transform', `translate(${size / 2},${size / 2})`)
    const gid = nextId('gg')
    const grad = svg.select('defs').empty() ? svg.append('defs') : svg.select('defs')
    const col = typeof color === 'function' ? color(value) : color
    const lg = grad.append('linearGradient').attr('id', gid).attr('x1', '0%').attr('x2', '100%')
    lg.append('stop').attr('offset', '0%').attr('stop-color', col).attr('stop-opacity', 0.35)
    lg.append('stop').attr('offset', '100%').attr('stop-color', col)
    const fglow = glow(svg, nextId('gl'), 2.5)

    const arc = d3.arc().cornerRadius(3)
    g.append('path').attr('d', arc({ innerRadius: r - 6, outerRadius: r, startAngle: a0, endAngle: a1 })).attr('fill', '#111b31')
    bands.forEach(([from, to, c]) =>
      g.append('path')
        .attr('d', d3.arc()({ innerRadius: r + 2, outerRadius: r + 4, startAngle: scale(from), endAngle: scale(to) }))
        .attr('fill', c)
        .attr('opacity', 0.75),
    )
    d3.range(0, 11).forEach((i) => {
      const a = a0 + ((a1 - a0) * i) / 10 - Math.PI / 2
      g.append('line')
        .attr('x1', Math.cos(a) * (r - 9)).attr('y1', Math.sin(a) * (r - 9))
        .attr('x2', Math.cos(a) * (r - (i % 5 ? 11 : 13))).attr('y2', Math.sin(a) * (r - (i % 5 ? 11 : 13)))
        .attr('stroke', C.dim).attr('stroke-width', 1)
    })
    if (value != null) {
      const path = g.append('path').attr('fill', `url(#${gid})`).attr('filter', fglow)
      path.transition().duration(900).ease(d3.easeCubicOut).attrTween('d', () => {
        const i = d3.interpolate(a0, scale(value))
        return (t) => arc({ innerRadius: r - 6, outerRadius: r, startAngle: a0, endAngle: i(t) })
      })
      const ae = scale(value) - Math.PI / 2
      g.append('circle').attr('cx', Math.cos(ae) * (r - 3)).attr('cy', Math.sin(ae) * (r - 3)).attr('r', 3).attr('fill', '#fff').attr('filter', fglow)
    }
    g.append('text').attr('text-anchor', 'middle').attr('y', 5).attr('fill', C.text)
      .style('font', `600 ${size > 100 ? 20 : 16}px JetBrains Mono, monospace`).text(value == null ? '—' : fmt(value))
    if (unit) g.append('text').attr('text-anchor', 'middle').attr('y', 20).attr('fill', C.muted).style('font', '10px Inter, sans-serif').text(unit)
  }, [value, min, max, size, color, bands, fmt, unit])
  return <svg ref={ref} style={{ flex: 'none' }} />
}

export function Sparkline({ values, width = 110, height = 26, color = C.cyan, area = true }) {
  const ref = useRef(null)
  useEffect(() => {
    const svg = d3.select(ref.current).attr('width', width).attr('height', height)
    svg.selectAll('*').remove()
    if (!values || !values.length) return
    const x = d3.scaleLinear().domain([0, values.length - 1]).range([1, width - 3])
    const [lo, hi] = d3.extent(values)
    const y = d3.scaleLinear().domain([lo - (hi - lo) * 0.1 || lo - 1, hi + (hi - lo) * 0.1 || hi + 1]).range([height - 2, 2])
    const id = nextId('sp')
    const lg = svg.append('defs').append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1)
    lg.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.35)
    lg.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0)
    if (area) svg.append('path').datum(values).attr('fill', `url(#${id})`).attr('d', d3.area().x((d, i) => x(i)).y0(height).y1((d) => y(d)).curve(d3.curveMonotoneX))
    svg.append('path').datum(values).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.4)
      .attr('d', d3.line().x((d, i) => x(i)).y((d) => y(d)).curve(d3.curveMonotoneX))
    svg.append('circle').attr('cx', x(values.length - 1)).attr('cy', y(values[values.length - 1])).attr('r', 2.2).attr('fill', color)
  }, [values, width, height, color, area])
  return <svg ref={ref} style={{ flex: 'none', display: 'block' }} />
}
