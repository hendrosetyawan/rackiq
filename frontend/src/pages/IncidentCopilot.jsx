import { useState } from 'react'
import { api } from '../api/client.js'
import CitationList from '../components/CitationList.jsx'

const SUGGESTIONS = [
  'PSU output ripple rising and fan RPM dropping, what should I do?',
  'DIMM correctable ECC errors climbing overnight, is a reseat enough?',
  'NIC link keeps flapping with CRC errors, replace the card or the transceiver?',
  'Disk showing reallocated sectors during a backup window, safe to hot-swap now?',
]

export default function IncidentCopilot() {
  const [query, setQuery] = useState('')
  const [component, setComponent] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function ask(text) {
    const q = (text ?? query).trim()
    if (!q) return
    setLoading(true)
    setError(null)
    try {
      const result = await api.copilot(q, component || undefined)
      setHistory((h) => [{ query: q, ...result }, ...h])
      setQuery('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="copilot">
      <section className="panel copilot-intro">
        <h2>Incident Copilot</h2>
        <p className="muted">
          Ask a troubleshooting question in plain language. Answers are assembled from retrieved
          historical tickets, RCAs, manuals and emails &mdash; every claim is cited back to a source
          document, and no external LLM is called in this prototype (retrieval + deterministic
          templating only).
        </p>
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="suggestion-chip" onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      </section>

      <section className="panel copilot-input-row">
        <select value={component} onChange={(e) => setComponent(e.target.value)}>
          <option value="">Any component</option>
          <option value="dimm">DIMM</option>
          <option value="disk">Disk</option>
          <option value="psu">PSU</option>
          <option value="nic">NIC</option>
        </select>
        <input
          type="text"
          placeholder="e.g. disk showing rising SMART errors during migration, what's the fix?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
        />
        <button onClick={() => ask()} disabled={loading}>
          {loading ? 'Searching...' : 'Ask'}
        </button>
      </section>

      {error && <div className="panel error">{error}</div>}

      <section className="copilot-history">
        {history.map((h, i) => (
          <div className="panel copilot-turn" key={i}>
            <p className="copilot-question">{h.query}</p>
            <pre className="copilot-answer">{h.answer}</pre>
            <CitationList citations={h.citations} />
          </div>
        ))}
      </section>
    </div>
  )
}
