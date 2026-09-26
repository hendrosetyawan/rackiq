import * as d3 from 'd3'

export const C = {
  bg: '#05080f',
  panel: '#0b1222',
  line: '#1a2742',
  line2: '#26395e',
  text: '#e2e8f0',
  muted: '#7d8ba8',
  dim: '#4b5a78',
  cyan: '#22d3ee',
  blue: '#3b82f6',
  violet: '#a78bfa',
  pink: '#f472b6',
  lime: '#a3e635',
  ok: '#10b981',
  watch: '#eab308',
  warn: '#f97316',
  crit: '#ef4444',
}

export const TIER = ['healthy', 'watch', 'warning', 'critical']
export const TIER_COLOR = { healthy: C.ok, watch: C.watch, warning: C.warn, critical: C.crit }
export const TIER_LABEL = { healthy: 'Healthy', watch: 'Watch', warning: 'Warning', critical: 'Critical' }

export const COMPONENTS = ['dimm', 'disk', 'psu', 'nic', 'fan']
export const COMP_COLOR = { dimm: C.blue, disk: C.violet, psu: C.pink, nic: C.cyan, fan: '#cbd5e1' }
export const COMP_LABEL = { dimm: 'DIMM', disk: 'Disk', psu: 'PSU', nic: 'NIC', fan: 'Fan' }

export const STATE_COLOR = {
  normal: C.dim,
  migration: C.cyan,
  backup_window: C.violet,
  dr_failover: C.pink,
  maintenance_window: C.lime,
}
export const STATE_LABEL = {
  normal: 'Normal',
  migration: 'Migration',
  backup_window: 'Backup window',
  dr_failover: 'DR failover',
  maintenance_window: 'Maint. window',
}

export const STOCK_COLOR = { stockout_risk: C.crit, reorder: C.warn, healthy: C.ok, overstock: C.violet }
export const STOCK_LABEL = { stockout_risk: 'Stockout risk', reorder: 'Reorder', healthy: 'Healthy', overstock: 'Overstock' }

export const PRIORITY_COLOR = { P1: C.crit, P2: C.warn, P3: C.watch, P4: '#64748b' }

export const thermal = d3
  .scaleLinear()
  .domain([19, 21.5, 24, 26.5, 29])
  .range(['#1d4ed8', '#06b6d4', '#84cc16', '#f59e0b', '#ef4444'])
  .clamp(true)

export const powerColor = (t) => d3.interpolateRgb('#0c2d48', '#67e8f9')(Math.max(0, Math.min(1, t)))

/** Adds a reusable glow filter to an svg selection; returns its url() ref. */
export function glow(svg, id, std = 3) {
  let defs = svg.select('defs')
  if (defs.empty()) defs = svg.append('defs')
  const f = defs.append('filter').attr('id', id).attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
  f.append('feGaussianBlur').attr('stdDeviation', std).attr('result', 'b')
  const m = f.append('feMerge')
  m.append('feMergeNode').attr('in', 'b')
  m.append('feMergeNode').attr('in', 'SourceGraphic')
  return `url(#${id})`
}

let uid = 0
export const nextId = (p = 'g') => `${p}${++uid}`
