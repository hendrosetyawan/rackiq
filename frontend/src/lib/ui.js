import { useEffect, useRef, useState } from 'react'

// ---- tooltip (single floating element shared by every chart)
let tt
function el() {
  if (!tt) {
    tt = document.createElement('div')
    tt.className = 'tt'
    document.body.appendChild(tt)
  }
  return tt
}
export const tip = {
  show(html, event) {
    const t = el()
    t.innerHTML = html
    t.style.opacity = 1
    tip.move(event)
  },
  move(event) {
    const t = el()
    const pad = 14
    const { innerWidth: W, innerHeight: H } = window
    const r = t.getBoundingClientRect()
    let x = event.clientX + pad
    let y = event.clientY + pad
    if (x + r.width > W - 8) x = event.clientX - r.width - pad
    if (y + r.height > H - 8) y = event.clientY - r.height - pad
    t.style.transform = `translate(${x}px, ${y}px)`
  },
  hide() {
    el().style.opacity = 0
  },
}

// ---- hooks
export function useApi(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    fn()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error: error.message, loading: false }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

export function useSize() {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      setSize((s) => (Math.abs(s.width - width) > 1 || Math.abs(s.height - height) > 1 ? { width, height } : s))
    })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

// ---- formatting
export const pct = (v, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`)
export const num = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }))
export const usd = (v) => (v == null ? '—' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
export const shortTime = (iso) => (iso ? iso.replace('T', ' ').slice(5, 16) : '')
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
