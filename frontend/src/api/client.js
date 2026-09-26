// Two modes:
// - Live (default, local dev): the real FastAPI backend at /api/*.
// - Static demo (VITE_DEMO_MODE=true, the Firebase Hosting build): no Python
//   backend online, so every call reads a precomputed JSON snapshot from
//   public/data/ (see scripts/export_static_demo.py).
const DEMO = import.meta.env.VITE_DEMO_MODE === 'true'

async function get(path, options) {
  const res = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...options })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

const cache = {}
function file(name) {
  if (!cache[name]) {
    cache[name] = fetch(`/data/${name}.json`).then((r) => {
      if (!r.ok) throw new Error(`Static snapshot missing: ${name}.json`)
      return r.json()
    })
  }
  return cache[name]
}

const rackOf = (assetId) => assetId.split('-')[0]
const words = (s) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2))

export const api = {
  isDemo: DEMO,
  overview: () => (DEMO ? file('overview') : get('/overview')),
  floor: () => (DEMO ? file('floor') : get('/floor')),
  servers: () => (DEMO ? file('servers') : get('/servers')),
  facility: () => (DEMO ? file('facility') : get('/telemetry/facility')),
  thermal: () => (DEMO ? file('thermal_matrix') : get('/telemetry/thermal-matrix')),
  modelTelemetry: () => (DEMO ? file('model_telemetry') : get('/model-telemetry')),
  workorders: () => (DEMO ? file('workorders') : get('/workorders')),
  forecast: () => (DEMO ? file('forecast') : get('/forecast')),
  incidents: () => (DEMO ? file('incidents') : get('/incidents')),
  events: () => (DEMO ? file('events') : get('/events?days=7')),
  inventory: () => (DEMO ? file('inventory') : get('/inventory')),
  inventoryHistory: () => (DEMO ? file('inventory_history') : get('/inventory/history')),
  consumption: () => (DEMO ? file('consumption') : get('/inventory/consumption')),

  asset: async (id) => {
    if (!DEMO) return get(`/assets/${id}`)
    const r = await file(`racks/${rackOf(id)}`)
    const a = r.assets[id]
    if (!a) throw new Error(`Unknown asset ${id}`)
    const srv = r.servers[a.server_id]
    return {
      ...a,
      series: { timestamp: r.timestamps, ...a.series },
      server_series: { timestamp: r.timestamps, ...Object.fromEntries(a.server_channels.map((k) => [k, srv[k]])) },
    }
  },
  recommend: async (id) => {
    if (!DEMO) return get(`/alerts/${id}/recommend`, { method: 'POST' })
    const r = await file(`racks/${rackOf(id)}`)
    return r.recs[id] || null
  },
  copilot: async (query, component) => {
    if (!DEMO) return get('/copilot', { method: 'POST', body: JSON.stringify({ query, component: component || null, top_k: 5 }) })
    const examples = await file('copilot_examples')
    const q = words(query)
    let best = null
    let bestScore = 0
    for (const ex of examples) {
      if (component && ex.component && ex.component !== component) continue
      const w = words(ex.query)
      let hit = 0
      q.forEach((t) => w.has(t) && hit++)
      const s = hit / Math.max(q.size, 1)
      if (s > bestScore) {
        bestScore = s
        best = ex
      }
    }
    if (!best || bestScore < 0.2)
      return {
        query,
        answer:
          'The hosted demo answers a fixed set of example questions (the suggestions) because it has no live backend. Run the project locally for open-ended queries against the full retrieval pipeline.',
        citations: [],
      }
    return { ...best, query }
  },
}
