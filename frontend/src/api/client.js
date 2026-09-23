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

export const api = {
  health: () => request('/health'),
  assets: () => request('/assets'),
  risk: () => request('/risk'),
  alerts: () => request('/alerts'),
  telemetry: (assetId, limit = 60) => request(`/telemetry/${assetId}?limit=${limit}`),
  recommend: (assetId) => request(`/alerts/${assetId}/recommend`, { method: 'POST' }),
  copilot: (query, component, topK = 5) =>
    request('/copilot', {
      method: 'POST',
      body: JSON.stringify({ query, component: component || null, top_k: topK }),
    }),
  evidence: (docId) => request(`/evidence/${docId}`),
  context: () => request('/context'),
  graphStats: () => request('/graph/stats'),
}
