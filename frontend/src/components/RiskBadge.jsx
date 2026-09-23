export default function RiskBadge({ score }) {
  const pct = Math.round(score * 100)
  let level = 'low'
  if (score >= 0.75) level = 'critical'
  else if (score >= 0.5) level = 'high'
  else if (score >= 0.25) level = 'medium'

  return (
    <span className={`risk-badge risk-${level}`}>
      <span className="risk-dot" />
      {pct}%
    </span>
  )
}
