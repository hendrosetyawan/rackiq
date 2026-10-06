import { NavLink } from 'react-router-dom'
import { api } from '../api/client.js'
import { COMP_COLOR, COMP_LABEL, STATE_COLOR, STATE_LABEL, STOCK_COLOR, STOCK_LABEL, TIER_COLOR, TIER_LABEL } from '../lib/theme.js'

const I = {
  command: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z',
  ops: 'M3 12h4l3-8 4 16 3-8h4',
  maint: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.8-.7-.7-2.8z',
  log: 'M4 6h16M4 12h16M4 18h10M18 15v6M15 18h6',
  inv: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  live: 'M12 2l9 5v10l-9 5-9-5V7zM12 12l9-5M12 12v10M12 12L3 7',
}

function Icon({ d }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

export function Sidebar({ overview }) {
  const items = [
    ['/', 'Command Center', I.command],
    ['/live', 'Live Floor 3D', I.live],
    ['/operations', 'Operations', I.ops],
    ['/maintenance', 'Maintenance', I.maint],
    ['/logs', 'Event Log', I.log],
    ['/inventory', 'Inventory', I.inv],
  ]
  return (
    <aside className="side">
      <div className="brand">
        <div className="brand-mark">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2">
            <rect x="5" y="3" width="14" height="18" rx="2" />
            <path d="M8 7h8M8 11h8M8 15h5" />
          </svg>
        </div>
        <div>
          <div className="brand-name">RackIQ</div>
          <div className="brand-sub">DC Intelligence</div>
        </div>
      </div>
      <div className="nav-sec">Data hall DH-1</div>
      <nav className="nav">
        {items.map(([to, label, d]) => (
          <NavLink key={to} to={to} end={to === '/'}>
            <Icon d={d} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="side-foot">
        <div className="row">
          <span>
            <span className="live-dot" />
            {api.isDemo ? 'Snapshot' : 'Live API'}
          </span>
          <span className="mono">{overview ? overview.as_of.slice(5, 16) : '—'}</span>
        </div>
        <div className="row">
          <span>Racks / servers</span>
          <span className="mono">{overview ? `${overview.counts.racks} / ${overview.counts.servers}` : '—'}</span>
        </div>
        <div className="row">
          <span>Model AUC (mean)</span>
          <span className="mono">{overview ? overview.model_auc_mean.toFixed(3) : '—'}</span>
        </div>
        <div className="row dim" style={{ marginTop: 6 }}>ABB Accelerator 2026 · Team RackIQ</div>
      </div>
    </aside>
  )
}

export function PageHead({ title, sub, overview, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <div className="right">
        {children}
        {api.isDemo && <span className="demo-chip">Static snapshot · no live backend</span>}
        {overview && <span className="mono">as of {overview.as_of.replace('T', ' ').slice(0, 16)}</span>}
      </div>
    </div>
  )
}

export function Panel({ title, sub, actions, children, style, bodyStyle, className = '' }) {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || actions) && (
        <div className="panel-h">
          <div className="panel-t">
            {title}
            {sub && <small>{sub}</small>}
          </div>
          {actions}
        </div>
      )}
      <div className="panel-b" style={bodyStyle}>
        {children}
      </div>
    </section>
  )
}

export const Loading = ({ label = 'Loading' }) => <div className="loading">{label}</div>

export function Dot({ color, glow }) {
  return <i style={{ background: color, boxShadow: glow ? `0 0 7px ${color}` : 'none' }} />
}

export const TierChip = ({ tier }) => (
  <span className="chip" style={{ color: TIER_COLOR[tier], borderColor: `${TIER_COLOR[tier]}55` }}>
    <Dot color={TIER_COLOR[tier]} glow />
    {TIER_LABEL[tier]}
  </span>
)
export const StateChip = ({ state }) =>
  state && state !== 'normal' ? (
    <span className="chip" style={{ color: STATE_COLOR[state], borderColor: `${STATE_COLOR[state]}55` }}>
      <Dot color={STATE_COLOR[state]} glow />
      {STATE_LABEL[state]}
    </span>
  ) : (
    <span className="chip">Normal</span>
  )
export const CompChip = ({ c }) => (
  <span className="chip" style={{ color: COMP_COLOR[c], borderColor: `${COMP_COLOR[c]}44` }}>
    {COMP_LABEL[c] || c}
  </span>
)
export const StockChip = ({ status }) =>
  status ? (
    <span className="chip" style={{ color: STOCK_COLOR[status], borderColor: `${STOCK_COLOR[status]}55` }}>
      <Dot color={STOCK_COLOR[status]} />
      {STOCK_LABEL[status]}
    </span>
  ) : (
    <span className="dim">—</span>
  )
