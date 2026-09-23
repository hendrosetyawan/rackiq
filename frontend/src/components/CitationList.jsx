export default function CitationList({ citations }) {
  if (!citations || citations.length === 0) {
    return <p className="muted">No supporting evidence retrieved.</p>
  }
  return (
    <ul className="citation-list">
      {citations.map((c) => (
        <li key={c.doc_id} className="citation-item">
          <div className="citation-head">
            <span className="citation-id">{c.doc_id}</span>
            <span className={`citation-type type-${c.doc_type}`}>{c.doc_type}</span>
            <span className="citation-ref">{c.source_ref}</span>
            {c.match_score != null && (
              <span className="citation-score">match {(c.match_score * 100).toFixed(0)}%</span>
            )}
            <span className={c.success ? 'outcome-success' : 'outcome-failed'}>
              {c.success ? 'resolved previously' : 'did not durably resolve'}
            </span>
          </div>
          <p className="citation-excerpt">{c.excerpt}</p>
        </li>
      ))}
    </ul>
  )
}
