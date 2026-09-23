// Two modes:
// - Live mode (default, local dev): talks to the real FastAPI backend at /api/*.
// - Static demo mode (VITE_DEMO_MODE=true, used for the Firebase Hosting build):
//   there is no Python backend online, so every call reads from precomputed
//   JSON snapshots in public/data/ instead (see scripts/export_static_demo.py).
//   This keeps the hosted demo fully interactive without running a server.
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'
const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${body}`)
  }
  return res.json()
}

const dataCache = {}
async function loadStatic(name) {
  if (dataCache[name]) return dataCache[name]
  const res = await fetch(`/data/${name}.json`)
  if (!res.ok) throw new Error(`Static demo data missing: ${name}.json`)
  const json = await res.json()
  dataCache[name] = json
  return json
}

function scoreOverlap(query, candidateQuery) {
  const norm = (s) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) || [])
  const a = norm(query)
  const b = norm(candidateQuery)
  let overlap = 0
  for (const w of a) if (b.has(w)) overlap += 1
  return overlap / Math.max(a.size, 1)
}

export const api = {
  health: () => (DEMO_MODE ? Promise.resolve({ status: 'ok (static demo)' }) : request('/health')),

  assets: () => (DEMO_MODE ? loadStatic('assets') : request('/assets')),

  risk: () => (DEMO_MODE ? loadStatic('risk') : request('/risk')),

  alerts: () => (DEMO_MODE ? loadStatic('alerts') : request('/alerts')),

  telemetry: async (assetId, limit = 60) => {
    if (DEMO_MODE) {
      const all = await loadStatic('telemetry')
      return (all[assetId] || []).slice(-limit)
    }
    return request(`/telemetry/${assetId}?limit=${limit}`)
  },

  recommend: async (assetId) => {
    if (DEMO_MODE) {
      const all = await loadStatic('recommendations')
      if (!all[assetId]) throw new Error(`No precomputed recommendation for ${assetId} in static demo`)
      return all[assetId]
    }
    return request(`/alerts/${assetId}/recommend`, { method: 'POST' })
  },

  copilot: async (query, component, topK = 5) => {
    if (DEMO_MODE) {
      const examples = await loadStatic('copilot_examples')
      const candidates = component ? examples.filter((e) => true) : examples
      let best = null
      let bestScore = -1
      for (const ex of candidates) {
        const s = scoreOverlap(query, ex.query)
        if (s > bestScore) {
          bestScore = s
          best = ex
        }
      }
      if (!best || bestScore < 0.15) {
        return {
          query,
          answer:
            'This static hosted demo only answers a fixed set of example questions (see the suggestions above) ' +
            "-- it has no live backend. Run the project locally (instructions_to_run.txt in the repo) for open-ended " +
            'Incident Copilot queries against the full retrieval pipeline.',
          citations: [],
        }
      }
      return { ...best, query }
    }
    return request('/copilot', {
      method: 'POST',
      body: JSON.stringify({ query, component: component || null, top_k: topK }),
    })
  },

  evidence: async (docId) => {
    if (DEMO_MODE) {
      const examples = await loadStatic('copilot_examples')
      for (const ex of examples) {
        const hit = ex.citations.find((c) => c.doc_id === docId)
        if (hit) return hit
      }
      const recs = await loadStatic('recommendations')
      for (const key of Object.keys(recs)) {
        const hit = recs[key].citations.find((c) => c.doc_id === docId)
        if (hit) return hit
      }
      throw new Error(`Document ${docId} not available in static demo export`)
    }
    return request(`/evidence/${docId}`)
  },

  context: () => (DEMO_MODE ? loadStatic('context') : request('/context')),

  graphStats: () => (DEMO_MODE ? loadStatic('graph_stats') : request('/graph/stats')),

  isDemoMode: DEMO_MODE,
}
