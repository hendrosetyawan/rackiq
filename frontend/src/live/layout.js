// Data-hall geometry in Claw3D canvas units (1 world unit = 1 / 0.018 canvas units).
// 5 rows (A-E) x 20 racks, cold aisles in front of each row, corridors on both
// ends, a NOC desk by the entrance, and a parts warehouse behind the east wall.

export const ROWS = ['A', 'B', 'C', 'D', 'E']
export const PER_ROW = 20
export const RACK_W = 34
export const RACK_D = 50
export const RACK_PITCH = 38
export const ROW_X0 = 420
export const ROW_Y = [560, 720, 880, 1040, 1200] // rack centre y per row
export const AISLE_Y = ROW_Y.map((y) => y + RACK_D / 2 + 30) // where crew stand
export const WEST_X = 360
export const EAST_X = 1215
export const NORTH_Y = 470
export const HALL = { x0: 300, x1: 1270, y0: 400, y1: 1310 }
export const WAREHOUSE = { x0: 1270, x1: 1640, y0: 400, y1: 1310 }
export const DOOR_Y = 860
export const LANE_X = 1460
export const BAY_Y = Array.from({ length: 8 }, (_, i) => 520 + i * 95)
export const ENTRANCE = { x: 300, y: NORTH_Y }
export const OUTSIDE = { x: 230, y: NORTH_Y }
export const NOC = { x: 500, y: 440, desk: { x: 500, y: 418 } }

export const rackCenter = (row, pos) => ({
  x: ROW_X0 + (pos - 1) * RACK_PITCH + RACK_W / 2,
  y: ROW_Y[ROWS.indexOf(row)],
})
export const rackFront = (rackId) => {
  const row = rackId[0]
  const pos = Number(rackId.slice(1))
  const c = rackCenter(row, pos)
  return { x: c.x, y: AISLE_Y[ROWS.indexOf(row)], facing: Math.PI, row: ROWS.indexOf(row) }
}

/** Warehouse bin for the i-th SKU: 8 bays on the west shelf, 8 on the east shelf. */
export const binSpot = (i) => {
  const left = i < 8
  const y = BAY_Y[i % 8]
  return {
    shelfX: left ? 1385 : 1535,
    y,
    stand: { x: left ? 1428 : 1492, y, facing: left ? -Math.PI / 2 : Math.PI / 2 },
    left,
  }
}

// ---------------------------------------------------------------- walking graph
const nodes = new Map()
const edges = new Map()
const node = (id, x, y) => {
  nodes.set(id, { id, x, y })
  edges.set(id, edges.get(id) || [])
  return id
}
const link = (a, b) => {
  edges.get(a).push(b)
  edges.get(b).push(a)
}

node('out', OUTSIDE.x, OUTSIDE.y)
node('ent', ENTRANCE.x, ENTRANCE.y)
node('nw', WEST_X, NORTH_Y)
node('noc', NOC.x, NORTH_Y)
node('nocdesk', NOC.x, NOC.y)
node('ne', EAST_X, NORTH_Y)
link('out', 'ent')
link('ent', 'nw')
link('nw', 'noc')
link('noc', 'nocdesk')
link('noc', 'ne')
let prevW = 'nw'
let prevE = 'ne'
AISLE_Y.forEach((ay, r) => {
  const w = node(`w${r}`, WEST_X, ay)
  const e = node(`e${r}`, EAST_X, ay)
  link(w, e)
  link(prevW, w)
  if (prevE === 'e1') {
    // the warehouse door sits on the east corridor between rows B and C
    node('door', EAST_X, DOOR_Y)
    link(prevE, 'door')
    prevE = 'door'
  }
  link(prevE, e)
  prevW = w
  prevE = e
})
node('dooro', 1270, DOOR_Y)
node('doori', 1330, DOOR_Y)
node('lane_door', LANE_X, DOOR_Y)
link('door', 'dooro')
link('dooro', 'doori')
link('doori', 'lane_door')
const laneYs = [...BAY_Y, DOOR_Y].sort((a, b) => a - b)
laneYs.forEach((y, i) => {
  const id = y === DOOR_Y ? 'lane_door' : node(`lane${i}`, LANE_X, y)
  if (i > 0) {
    const prevY = laneYs[i - 1]
    link(prevY === DOOR_Y ? 'lane_door' : `lane${i - 1}`, id)
  }
})

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/** Attach a free point (rack front, bin, NOC) to the graph and return its anchor node ids. */
function anchorsFor(p) {
  if (p.x > HALL.x1) {
    // warehouse: snap to the lane node at the same height
    const i = laneYs.reduce((best, y, k) => (Math.abs(y - p.y) < Math.abs(laneYs[best] - p.y) ? k : best), 0)
    return [laneYs[i] === DOOR_Y ? 'lane_door' : `lane${i}`]
  }
  const r = AISLE_Y.findIndex((ay) => Math.abs(ay - p.y) < 2)
  if (r >= 0) return [`w${r}`, `e${r}`]
  if (Math.abs(p.y - NOC.y) < 2 && Math.abs(p.x - NOC.x) < 2) return ['nocdesk']
  // fall back to nearest node
  let best = null
  for (const n of nodes.values()) if (!best || dist(n, p) < dist(best, p)) best = n
  return [best.id]
}

/** Shortest walking route between two free points, as a list of canvas points. */
export function route(from, to) {
  const start = anchorsFor(from)
  const goal = new Set(anchorsFor(to))
  const d = new Map()
  const prev = new Map()
  const q = new Set(nodes.keys())
  for (const id of nodes.keys()) d.set(id, Infinity)
  start.forEach((id) => {
    d.set(id, dist(from, nodes.get(id)))
    prev.set(id, null)
  })
  let reached = null
  while (q.size) {
    let u = null
    for (const id of q) if (u === null || d.get(id) < d.get(u)) u = id
    q.delete(u)
    if (goal.has(u)) {
      reached = u
      break
    }
    for (const v of edges.get(u)) {
      if (!q.has(v)) continue
      const alt = d.get(u) + dist(nodes.get(u), nodes.get(v))
      if (alt < d.get(v)) {
        d.set(v, alt)
        prev.set(v, u)
      }
    }
  }
  const path = []
  for (let id = reached; id; id = prev.get(id)) path.unshift({ x: nodes.get(id).x, y: nodes.get(id).y })
  path.push({ x: to.x, y: to.y })
  // drop zero-length hops
  return path.filter((p, i) => i === 0 || dist(p, path[i - 1]) > 0.5)
}
