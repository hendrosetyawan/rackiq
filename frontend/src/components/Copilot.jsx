import { useState } from 'react'
import { api } from '../api/client.js'
import { COMPONENTS, COMP_LABEL, C } from '../lib/theme.js'

export const COPILOT_SUGGESTIONS = [
  'Disk latency spiking with rising SMART read errors, replace now or wait?',
  'DIMM correctable ECC errors climbing, is a reseat enough?',
  'NIC link flapping with CRC errors, card or transceiver?',
  'Fan vibration rising while RPM drops',
  'PSU ripple rising and input voltage sagging during a backup window',
  'Inlet temperature rising across several racks in one cooling zone',
]

export default function Copilot({ compact = false }) {
  const [q, setQ] = useState('')
  const [comp, setComp] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(null)

  async function ask(text) {
    const query = (text ?? q).trim()
    if (!query) return
    setBusy(true)
    setQ(query)
    try {
      setRes(await api.copilot(query, comp))
    } catch (e) {
      setRes({ query, answer: e.message, citations: [] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {COPILOT_SUGGESTIONS.slice(0, compact ? 4 : 6).map((s) => (
          <button key={s} className="pill-btn" onClick={() => ask(s)}>{s}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <select className="input" style={{ width: 120 }} value={comp} onChange={(e) => setComp(e.target.value)}>
          <option value="">Any part</option>
          {COMPONENTS.map((c) => <option key={c} value={c}>{COMP_LABEL[c]}</option>)}
        </select>
        <input className="input" placeholder="Describe the symptom…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
        <button className="btn" onClick={() => ask()} disabled={busy}>{busy ? '…' : 'Ask'}</button>
      </div>
      <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
        {res && res.citations.length === 0 && <div className="muted" style={{ fontSize: 12 }}>{res.answer}</div>}
        {res && res.citations.map((c, i) => {
          const st = c.stats || {}
          const durable = st.durable_rate
          const color = durable == null ? C.muted : durable >= 0.85 ? C.ok : durable >= 0.6 ? C.watch : C.crit
          return (
            <div key={c.doc_id} className="step" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === i ? null : i)}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <span className="mono" style={{ color: C.cyan, fontSize: 11 }}>{i + 1}</span>
                <span className="chip" style={{ fontSize: 10 }}>{c.template_id}</span>
                {durable != null && <span className="chip" style={{ color, borderColor: `${color}55`, fontSize: 10 }}>durable {Math.round(durable * 100)}%</span>}
                {st.n != null && <span className="dim" style={{ fontSize: 10.5 }}>used {st.n}× · MTTR {st.median_mttr_h} h</span>}
              </div>
              <div style={{ fontSize: 12 }}>{res.answer.split('\n')[i + 1]?.replace(/^\d+\. \[[^\]]+\] /, '').replace(/ \(used.*\)$/, '')}</div>
              {open === i && (
                <div className="cite">
                  <span className="mono" style={{ color: C.cyan }}>{c.doc_id}</span> · {c.doc_type} · {c.source_ref} {c.date ? `· ${c.date}` : ''}
                  {'\n'}
                  {c.excerpt}…
                </div>
              )}
            </div>
          )
        })}
        {!res && <div className="dim" style={{ fontSize: 11.5 }}>Answers come from 12 months of tickets, RCAs, manuals and emails — ranked by relevance and by how often each fix actually held. Every answer cites its source.</div>}
      </div>
    </div>
  )
}
