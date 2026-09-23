const LABELS = {
  normal: { text: 'Normal', cls: 'ctx-normal' },
  migration: { text: 'Migration in progress', cls: 'ctx-hot' },
  backup_window: { text: 'Backup window', cls: 'ctx-hot' },
  dr_failover: { text: 'DR failover active', cls: 'ctx-critical' },
}

export default function ContextBadge({ state }) {
  const meta = LABELS[state] || { text: state, cls: 'ctx-normal' }
  return <span className={`ctx-badge ${meta.cls}`}>{meta.text}</span>
}
