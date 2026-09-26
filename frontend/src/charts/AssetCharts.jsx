import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { C, thermal } from '../lib/theme.js'
import { tip, useSize } from '../lib/ui.js'

const UNITS = {
  ecc_correctable_24h: '/24h', ecc_uncorrectable_24h: '/24h', temp_c: '°C', reallocated_sectors: '', pending_sectors: '',
  smart_read_error_rate: '', io_latency_ms: 'ms', input_voltage_v: 'V', output_ripple_mv: 'mV', fan_rpm: 'rpm',
  efficiency_pct: '%', link_flap_count_24h: '/24h', crc_errors_24h: '/24h', packet_loss_pct: '%', vibration_mm_s: 'mm/s',
  motor_current_a: 'A', inlet_temp_c: '°C', power_w: 'W', cpu_util_pct: '%', mem_util_pct: '%', disk_latency_ms: 'ms', cpu_temp_c: '°C',
}

/* Small multiples: one sparkline-with-axes per telemetry channel; the live
   (held-out) window is shaded so it's clear which readings the model scored. */
export function ChannelMultiples({ series, channels, color = C.cyan, liveWindow = 16, highlight = [] }) {
  const [wrap, size] = useSize()
  const ref = useRef(null)
  useEffect(() => {
    if (!series || !size.width) return
    const width = size.width
    const cols = channels.length > 3 ? 2 : 1
    const cw = width / cols
    const ch = 78
    const rowsN = Math.ceil(channels.length / cols)
    const height = rowsN * ch
    const svg = d3.select(ref.current).attr('width', width).attr('height', height)
    svg.selectAll('*').remove()
    const t = series.timestamp.map((s) => new Date(s))
    channels.forEach((k, i) => {
      const gx = (i % cols) * cw
      const gy = Math.floor(i / cols) * ch
      const m = { t: 16, r: 12, b: 14, l: 34 }
      const g = svg.append('g').attr('transform', `translate(${gx},${gy})`)
      const vals = series[k]
      const x = d3.scaleTime().domain(d3.extent(t)).range([m.l, cw - m.r])
      const [lo, hi] = d3.extent(vals)
      const pad = (hi - lo) * 0.12 || 1
      const y = d3.scaleLinear().domain([lo - pad, hi + pad]).range([ch - m.b, m.t])
      const hot = highlight.includes(k)
      const col = hot ? C.warn : color
      g.append('rect').attr('x', x(t[Math.max(0, t.length - liveWindow)])).attr('y', m.t).attr('width', x(t[t.length - 1]) - x(t[Math.max(0, t.length - liveWindow)]))
        .attr('height', ch - m.t - m.b).attr('fill', 'rgba(34,211,238,.06)')
      g.append('text').attr('x', m.l).attr('y', 10).attr('fill', hot ? C.warn : C.muted).style('font', `600 9.5px JetBrains Mono`).text(`${k}${hot ? '  ◀ driver' : ''}`)
      g.append('text').attr('x', cw - m.r).attr('y', 10).attr('text-anchor', 'end').attr('fill', C.text).style('font', '600 10px JetBrains Mono')
        .text(`${vals[vals.length - 1]?.toFixed(2)} ${UNITS[k] || ''}`)
      g.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(2).tickSize(-(cw - m.l - m.r)))
        .call((a) => { a.select('.domain').remove(); a.selectAll('line').attr('stroke', C.line).attr('stroke-dasharray', '2 4'); a.selectAll('text').attr('fill', C.dim).style('font', '8px JetBrains Mono') })
      const id = `cm${i}${Math.round(Math.random() * 1e6)}`
      const lg = svg.append('defs').append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1)
      lg.append('stop').attr('offset', '0%').attr('stop-color', col).attr('stop-opacity', 0.3)
      lg.append('stop').attr('offset', '100%').attr('stop-color', col).attr('stop-opacity', 0)
      const pts = vals.map((v, j) => [t[j], v])
      g.append('path').datum(pts).attr('fill', `url(#${id})`).attr('d', d3.area().x((d) => x(d[0])).y0(ch - m.b).y1((d) => y(d[1])).curve(d3.curveMonotoneX))
      g.append('path').datum(pts).attr('fill', 'none').attr('stroke', col).attr('stroke-width', 1.3).attr('d', d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX))
      g.append('rect').attr('x', m.l).attr('y', m.t).attr('width', cw - m.l - m.r).attr('height', ch - m.t - m.b).attr('fill', 'transparent')
        .on('mousemove', (e) => {
          const [mx] = d3.pointer(e)
          const j = d3.bisector((d) => d).center(t, x.invert(mx))
          tip.show(`<div class="h">${k}</div>${series.timestamp[j].replace('T', ' ')}<br/><b>${vals[j]?.toFixed(3)}</b> ${UNITS[k] || ''}`, e)
        })
        .on('mouseleave', () => tip.hide())
    })
  }, [series, channels, size, color, liveWindow, highlight])
  return (
    <div ref={wrap} style={{ width: '100%' }}>
      <svg ref={ref} />
    </div>
  )
}

/* Diverging SHAP contribution bars. */
export function ShapBars({ factors }) {
  const [wrap, size] = useSize()
  const ref = useRef(null)
  useEffect(() => {
    if (!factors || !size.width) return
    const width = size.width
    const rowH = 24
    const height = factors.length * rowH + 16
    const svg = d3.select(ref.current).attr('width', width).attr('height', height)
    svg.selectAll('*').remove()
    const lab = 170
    const lim = d3.max(factors, (f) => Math.abs(f.shap_contribution)) || 1
    const x = d3.scaleLinear().domain([-lim, lim]).range([lab, width - 50])
    svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', height - 12).attr('stroke', C.line2)
    factors.forEach((f, i) => {
      const y = i * rowH + 4
      const v = f.shap_contribution
      svg.append('text').attr('x', 0).attr('y', y + 12).attr('fill', C.text).style('font', '10px JetBrains Mono').text(f.feature)
      svg.append('rect').attr('x', Math.min(x(0), x(v))).attr('y', y + 2).attr('height', rowH - 10).attr('rx', 3)
        .attr('fill', v > 0 ? C.crit : C.ok).attr('opacity', 0.85).attr('width', 0).transition().duration(700).attr('width', Math.abs(x(v) - x(0)))
      svg.append('text').attr('x', v > 0 ? x(v) + 5 : x(v) - 5).attr('text-anchor', v > 0 ? 'start' : 'end').attr('y', y + 12)
        .attr('fill', v > 0 ? C.crit : C.ok).style('font', '600 10px JetBrains Mono').text(`${v > 0 ? '+' : ''}${v.toFixed(2)}`)
    })
    svg.append('text').attr('x', x(0)).attr('y', height - 1).attr('text-anchor', 'middle').attr('fill', C.dim).style('font', '8.5px Inter').text('← lowers risk · raises risk →')
  }, [factors, size])
  return (
    <div ref={wrap} style={{ width: '100%' }}>
      <svg ref={ref} />
    </div>
  )
}

export { thermal }
