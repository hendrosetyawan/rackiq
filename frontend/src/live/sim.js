// Live floor simulation: crew shifts, jobs, spare-part stock and server states.
//
// Seeded from RackIQ's real outputs (floor status, ranked work orders, warehouse
// stock). Crew movement runs in real time; work durations, stock arrivals and the
// shift clock run in simulated time at `speed`x so an 8-hour shift can be watched.
import { NOC, OUTSIDE, ENTRANCE, binSpot, rackFront, route } from './layout.js'
import { crewFor, shiftAt, shiftWindow } from './crews.js'

export const STATUS_ORDER = ['failed', 'critical', 'warning', 'maintenance', 'watch', 'offline', 'empty', 'healthy']
export const STATUS_LABEL = {
  healthy: 'Healthy',
  watch: 'Watch',
  warning: 'Warning',
  critical: 'Danger',
  failed: 'Down / broken',
  maintenance: 'Under service',
  empty: 'Unoccupied slot',
  offline: 'Powered off',
}
export const STATUS_COLOR = {
  healthy: '#22c55e',
  watch: '#eab308',
  warning: '#f97316',
  critical: '#ef4444',
  failed: '#ff2d55',
  maintenance: '#3b82f6',
  empty: '#0b1120',
  offline: '#64748b',
}
const PART_LABEL = { dimm: 'DIMM', disk: 'drive', psu: 'PSU', nic: 'NIC', fan: 'fan module' }
const WALK = 78 // canvas units per real second (~1.4 m/s)
const H = 3600_000

export function skuFor(component, vendor, workload) {
  const ai = workload === 'ai'
  switch (component) {
    case 'dimm':
      return 'MEM-DDR5-64G-4800'
    case 'disk':
      return workload === 'storage' ? 'HDD-SAS-12T' : 'SSD-NVME-U2-3T84'
    case 'psu':
      return ai ? 'PSU-GPU-2800W' : { Dell: 'PSU-DEL-1400W', HPE: 'PSU-HPE-1600W', Lenovo: 'PSU-LNV-1100W' }[vendor]
    case 'fan':
      return ai ? 'FAN-GPU-HP80' : { Dell: 'FAN-DEL-R760', HPE: 'FAN-HPE-DL380', Lenovo: 'FAN-LNV-SR650' }[vendor]
    case 'nic':
      return ai ? 'NIC-CX7-100G-DP' : 'NIC-OCP3-25G-DP'
    default:
      return null
  }
}

let rng = 1234567
const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]

export class LiveSim {
  constructor({ floor, workorders, inventory, asOf = null, now = new Date(), speed = 60 }) {
    // purchase-order ETAs in the snapshot are relative to its timestamp; replay them from `now`
    const etaShift = asOf ? now.getTime() - Date.parse(asOf.replace(' ', 'T')) : 0
    this.speed = speed
    this.simTime = now.getTime()
    this.version = 0
    this.statusVersion = 0
    this.log = []
    this.agents = []
    this.jobs = []
    this.jobSeq = 0

    this.racks = floor.racks.map((r) => ({ id: r.rack_id, row: r.row, pos: r.pos, vendor: r.vendor, state: r.state, workload: r.workload }))
    this.rackById = new Map(this.racks.map((r) => [r.id, r]))
    this.servers = new Map()
    for (const r of floor.racks)
      for (const s of r.slots)
        this.servers.set(s.server_id, {
          id: s.server_id, rack: r.rack_id, slot: s.slot, status: s.status, model: s.model, workload: s.workload,
          vendor: r.vendor, worstComponent: s.worst_component, worstAsset: s.worst_asset, risk: s.max_risk, inlet: s.inlet,
        })

    this.stock = new Map(
      inventory.map((s, i) => [s.sku, {
        sku: s.sku, desc: s.desc, idx: i, spot: binSpot(i), bin: s.bin, onHand: s.on_hand, reorderPoint: s.reorder_point,
        reorderQty: s.reorder_qty, leadDays: s.lead_time_days, unitCost: s.unit_cost,
        inbound: s.inbound_qty, eta: s.next_arrival ? Math.max(now.getTime() + 2 * H, Date.parse(`${s.next_arrival}T07:00:00`) + etaShift) : null, picked: 0,
      }]),
    )

    // planned maintenance window: some servers powered off, one pulled for refresh
    for (const r of this.racks.filter((x) => x.state === 'maintenance_window')) {
      this.setStatus(`${r.id}-S8`, 'offline')
      this.setStatus(`${r.id}-S7`, 'offline')
      this.setStatus(`${r.id}-S6`, 'empty')
    }

    // jobs from RackIQ's ranked work orders
    for (const w of workorders) {
      const srv = this.servers.get(w.server_id)
      if (!srv || ['offline', 'empty'].includes(srv.status)) continue
      if (this.jobs.some((j) => j.serverId === w.server_id)) continue
      const kind = w.tier === 'watch' ? 'inspect' : 'repair'
      this.addJob({ serverId: w.server_id, assetId: w.asset_id, component: w.component, sku: kind === 'repair' ? w.sku : null,
        hours: kind === 'repair' ? w.est_mttr_h || 1.5 : 0.5, priority: w.priority_score, tier: w.tier, kind, silent: true })
    }
    // the two most urgent critical servers whose spare is short have already gone down
    const short = this.jobs.filter((j) => j.tier === 'critical' && j.sku && this.stock.get(j.sku)?.onHand <= 4).slice(0, 2)
    for (const j of short) this.failServer(j, true)

    this.shift = shiftAt(new Date(this.simTime))
    this.spawnCrew(this.shift, { initial: true })
    this.addLog('shift', `${this.shift.name} shift (${this.shift.id}) on duty · ${this.jobs.filter((j) => j.status !== 'done').length} open jobs from RackIQ`)
  }

  // ------------------------------------------------------------ state helpers
  setStatus(serverId, status) {
    const s = this.servers.get(serverId)
    if (!s || s.status === status) return
    s.status = status
    this.statusVersion++
  }

  addLog(kind, text, who = null) {
    this.log.unshift({ t: this.simTime, kind, text, who })
    if (this.log.length > 250) this.log.pop()
  }

  addJob({ serverId, assetId, component, sku, hours, priority, tier, kind, silent = false }) {
    const job = { id: `J${String(++this.jobSeq).padStart(4, '0')}`, serverId, assetId, component, sku, hours, priority, tier, kind,
      status: 'queued', created: this.simTime, tech: null, done: 0, partInHand: false }
    this.jobs.push(job)
    if (!silent) this.addLog('alert', `RackIQ alert: ${assetId} ${tier} → ${job.id} queued`)
    return job
  }

  failServer(job, initial = false) {
    job.kind = 'swap'
    job.tier = 'failed'
    job.priority += 40
    this.setStatus(job.serverId, 'failed')
    if (!initial) this.addLog('alert', `${job.serverId} went DOWN (${PART_LABEL[job.component]} failure) — ${job.id} escalated`)
  }

  // ------------------------------------------------------------ crew
  spawnCrew(shift, { initial = false } = {}) {
    crewFor(shift).forEach((m, i) => {
      const a = {
        ...m, status: 'idle', item: 'rackiq', x: OUTSIDE.x - i * 18, y: OUTSIDE.y + (i % 2) * 14, facing: Math.PI / 2,
        frame: Math.floor(rand() * 100), phaseOffset: rand() * 6, state: 'standing', plan: [], action: null, carrying: null,
        task: '', job: null, speech: '', speechUntil: 0, battery: 100, signal: 4, progress: 0, activity: 'Arriving', leaving: false,
      }
      if (initial) {
        // place the opening crew on the floor already, staggered along the corridor
        a.x = NOC.x + 30 + i * 70
        a.y = 470
      }
      a.plan.push({ type: 'walk', to: { x: NOC.x - 40 + i * 20, y: NOC.y, facing: Math.PI }, label: 'To NOC briefing' })
      a.plan.push({ type: 'work', task: 'scan', simMs: 0.15 * H, label: 'Shift briefing at NOC', speech: initial ? null : 'Handover briefing' })
      this.agents.push(a)
    })
  }

  handover(next) {
    const prev = this.shift
    this.shift = next
    this.addLog('shift', `Shift change: ${prev.name} (${prev.id}) → ${next.name} (${next.id}) · handover at NOC`)
    for (const a of this.agents) {
      if (a.leaving) continue
      a.leaving = true
      if (a.job) {
        const job = this.jobs.find((j) => j.id === a.job)
        if (job && job.status !== 'done') {
          job.status = 'queued'
          job.tech = null
          if (a.carrying) job.partInHand = true
          this.addLog('shift', `${job.id} handed over by ${a.name} (${Math.round(job.done * 100)}% done)`, a.name)
        }
      }
      a.job = null
      a.carrying = null
      a.plan = [
        { type: 'walk', to: { x: ENTRANCE.x, y: ENTRANCE.y }, label: 'End of shift' },
        { type: 'walk', to: { x: OUTSIDE.x, y: OUTSIDE.y }, label: 'Leaving' },
        { type: 'despawn' },
      ]
      a.action = null
      a.status = 'idle'
      this.say(a, 'Shift over — handing over')
    }
    this.spawnCrew(next)
  }

  say(a, text, ms = 5000) {
    a.speech = text
    a.speechUntil = performance.now() + ms
  }

  nextJobFor(a) {
    const open = this.jobs.filter((j) => j.status === 'queued' && (!j.sku || j.partInHand || (this.stock.get(j.sku)?.onHand ?? 0) > 0))
    open.sort((x, y) => y.priority - x.priority || x.created - y.created)
    return open[0] || null
  }

  planTechnician(a) {
    const job = this.nextJobFor(a)
    if (!job) {
      // nothing queued: inspection round on a random rack
      const r = pick(this.racks)
      a.plan.push({ type: 'walk', to: rackFront(r.id), label: `Patrol to ${r.id}` })
      a.plan.push({ type: 'work', task: 'scan', simMs: 0.2 * H, label: `Patrol scan ${r.id}`,
        onDone: () => this.addLog('job', `Patrol scan ${r.id}: OK`, a.name) })
      return
    }
    job.status = 'assigned'
    job.tech = a.id
    a.job = job.id
    const srv = this.servers.get(job.serverId)
    const part = PART_LABEL[job.component] || job.component
    if (job.sku && !job.partInHand) {
      const st = this.stock.get(job.sku)
      a.plan.push({ type: 'walk', to: st.spot.stand, label: `To warehouse · ${job.sku}`, speech: `Fetching ${job.sku} for ${job.serverId}` })
      a.plan.push({
        type: 'work', task: 'scan', simMs: 0.07 * H, label: `Scanning bin ${st.bin}`,
        onDone: () => {
          if (st.onHand <= 0) {
            job.status = 'queued'
            job.tech = null
            a.job = null
            a.plan = []
            this.addLog('stock', `Bin ${st.bin} empty — ${job.id} waiting for ${job.sku}`, a.name)
            return
          }
          st.onHand -= 1
          st.picked += 1
          a.carrying = job.sku
          this.addLog('stock', `${a.name} scanned ${job.sku} out of bin ${st.bin} · ${st.onHand + 1} → ${st.onHand} on hand`, a.name)
          this.checkReorder(st)
        },
      })
    } else if (job.partInHand) {
      a.carrying = job.sku
    }
    const front = rackFront(srv.rack)
    const offset = (srv.slot % 2 ? -1 : 1) * 6
    a.plan.push({ type: 'walk', to: { ...front, x: front.x + offset }, label: `To ${srv.rack} slot ${srv.slot}` })
    const verb = job.kind === 'inspect' ? 'Inspecting' : job.kind === 'swap' ? 'Swapping' : 'Replacing'
    a.plan.push({
      type: 'work', task: job.kind === 'inspect' ? 'scan' : 'repair', simMs: job.hours * H * (1 - job.done), job: job.id,
      label: job.kind === 'inspect' ? `Inspecting ${job.serverId}` : `${verb} ${part} · ${job.serverId}`,
      speech: job.kind === 'inspect' ? `Inspecting ${job.serverId}` : `${verb} ${part} on ${job.serverId}`,
      onStart: () => {
        job.status = 'in_progress'
        if (job.kind === 'swap') this.setStatus(job.serverId, 'empty')
        else if (job.kind === 'repair') this.setStatus(job.serverId, 'maintenance')
        this.addLog('job', `${a.name} started ${job.id}: ${verb.toLowerCase()} ${part} on ${job.serverId}`, a.name)
      },
      onProgress: (p) => {
        job.done = p
        if (job.kind === 'swap' && p > 0.35) this.setStatus(job.serverId, 'maintenance')
      },
      onDone: () => {
        job.status = 'done'
        job.finished = this.simTime
        a.carrying = null
        a.job = null
        if (job.kind === 'inspect' && rand() < 0.25) {
          this.setStatus(job.serverId, 'warning')
          const sku = skuFor(job.component, srv.vendor, srv.workload)
          this.addJob({ serverId: job.serverId, assetId: job.assetId, component: job.component, sku, hours: 1.2, priority: 70, tier: 'warning', kind: 'repair' })
          this.addLog('job', `${a.name}: ${job.serverId} inspection found wear — repair queued`, a.name)
        } else {
          this.setStatus(job.serverId, 'healthy')
          this.addLog('job', `${a.name} closed ${job.id}: ${job.serverId} healthy (${(job.hours).toFixed(1)} h)`, a.name)
        }
      },
    })
  }

  planSuperintendent(a) {
    const active = this.jobs.filter((j) => j.status === 'in_progress')
    const sensitive = active.find((j) => {
      const r = this.rackById.get(this.servers.get(j.serverId).rack)
      return (r.state === 'dr_failover' || r.state === 'migration' || j.kind === 'swap') && !j.approved
    })
    if (sensitive) {
      const srv = this.servers.get(sensitive.serverId)
      const r = this.rackById.get(srv.rack)
      const front = rackFront(srv.rack)
      a.plan.push({ type: 'walk', to: { ...front, x: front.x + 26 }, label: `To ${srv.rack} (${r.state.replace('_', ' ')})` })
      a.plan.push({
        type: 'work', task: 'scan', simMs: 0.25 * H, label: `Approving ${sensitive.id} on ${srv.rack}`,
        speech: r.state === 'dr_failover' ? 'DR runbook checked — proceed' : r.state === 'migration' ? 'Migration path moved — proceed' : 'Server swap approved',
        onDone: () => {
          sensitive.approved = true
          this.addLog('job', `${a.name} approved ${sensitive.id} on ${srv.rack} (${r.state === 'normal' ? 'server swap' : r.state.replace('_', ' ')})`, a.name)
        },
      })
      return
    }
    const low = [...this.stock.values()].find((s) => s.onHand <= s.reorderPoint && !s.expedited)
    if (low && rand() < 0.5) {
      a.plan.push({ type: 'walk', to: low.spot.stand, label: `Stock check ${low.sku}` })
      a.plan.push({
        type: 'work', task: 'scan', simMs: 0.12 * H, label: `Expediting ${low.sku}`, speech: `${low.sku} low — expediting PO`,
        onDone: () => {
          low.expedited = true
          if (!low.eta || low.eta > this.simTime + 12 * H) {
            low.eta = this.simTime + 12 * H
            low.inbound = Math.max(low.inbound, low.reorderQty)
          }
          this.addLog('stock', `${a.name} expedited PO for ${low.sku}: ${low.inbound} units, ETA +12 h`, a.name)
        },
      })
      return
    }
    a.plan.push({ type: 'walk', to: { x: NOC.x, y: NOC.y, facing: Math.PI }, label: 'To NOC desk' })
    a.plan.push({ type: 'work', task: 'scan', simMs: 0.4 * H, label: 'Monitoring RackIQ queue at NOC' })
  }

  checkReorder(st) {
    if (st.onHand <= st.reorderPoint && !st.eta) {
      st.eta = this.simTime + Math.min(st.leadDays, 5) * 24 * H
      st.inbound = st.reorderQty
      this.addLog('stock', `${st.sku} at reorder point (${st.onHand} ≤ ${st.reorderPoint}) — PO auto-raised for ${st.reorderQty}`)
    }
  }

  // ------------------------------------------------------------ main loop
  step(dtReal) {
    const dt = Math.min(dtReal, 0.1)
    const simDelta = dt * 1000 * this.speed
    this.simTime += simDelta
    const walkFactor = this.speed >= 600 ? 3 : this.speed >= 120 ? 1.6 : 1

    const next = shiftAt(new Date(this.simTime))
    if (next.id !== this.shift.id) this.handover(next)

    // stock arrivals
    for (const st of this.stock.values()) {
      if (st.eta && st.eta <= this.simTime && st.inbound > 0) {
        st.onHand += st.inbound
        this.addLog('stock', `PO received: ${st.inbound} × ${st.sku} into bin ${st.bin} (${st.onHand} on hand)`)
        st.inbound = 0
        st.eta = null
        st.expedited = false
      }
    }

    // new RackIQ alerts at the fleet's historical rate (~3.9/day), and escalation of neglected critical work
    if (rand() < (3.9 / 24 / H) * simDelta) {
      const srv = pick([...this.servers.values()].filter((s) => s.status === 'healthy'))
      const comp = pick(['dimm', 'disk', 'psu', 'nic', 'fan'])
      const tier = rand() < 0.4 ? 'critical' : 'warning'
      this.setStatus(srv.id, tier)
      this.addJob({ serverId: srv.id, assetId: `${srv.id}-${comp.toUpperCase()}`, component: comp, sku: skuFor(comp, srv.vendor, srv.workload),
        hours: 0.6 + rand() * 1.8, priority: tier === 'critical' ? 92 : 70, tier, kind: 'repair' })
    }
    // a critical part left waiting more than 8 h has a ~1.5%/h chance of failing outright
    for (const j of this.jobs) {
      if (j.status === 'queued' && j.tier === 'critical' && this.simTime - j.created > 8 * H && rand() < (0.015 / H) * simDelta) this.failServer(j)
    }

    for (const a of this.agents) this.stepAgent(a, dt, simDelta, walkFactor)
    this.agents = this.agents.filter((a) => !a.gone)
    this.version++
  }

  stepAgent(a, dt, simDelta, walkFactor) {
    a.frame += dt * 60
    a.battery = Math.max(5, a.battery - (simDelta / H) * (a.role === 'superintendent' ? 4 : 6))
    if (!a.action) {
      if (!a.plan.length) {
        if (a.leaving) return
        if (a.role === 'superintendent') this.planSuperintendent(a)
        else this.planTechnician(a)
      }
      a.action = a.plan.shift()
      if (!a.action) return
      const act = a.action
      if (act.type === 'despawn') {
        a.gone = true
        return
      }
      if (act.type === 'walk') {
        act.path = route({ x: a.x, y: a.y }, act.to)
        a.state = 'walking'
        a.status = a.leaving ? 'idle' : 'working'
        a.task = ''
      } else {
        act.elapsed = 0
        a.state = 'standing'
        a.status = 'working'
        a.task = act.task
        act.onStart?.()
      }
      a.activity = act.label
      if (act.speech) this.say(a, act.speech)
    }
    const act = a.action
    if (act.type === 'walk') {
      let budget = WALK * walkFactor * dt
      while (budget > 0 && act.path.length) {
        const tgt = act.path[0]
        const dx = tgt.x - a.x
        const dy = tgt.y - a.y
        const d = Math.hypot(dx, dy)
        if (d < 0.01) {
          act.path.shift()
          continue
        }
        a.facing = Math.atan2(dx, dy)
        const stepLen = Math.min(budget, d)
        a.x += (dx / d) * stepLen
        a.y += (dy / d) * stepLen
        budget -= stepLen
        if (stepLen >= d) act.path.shift()
      }
      a.progress = 0
      if (!act.path.length) {
        if (act.to.facing !== undefined) a.facing = act.to.facing
        a.action = null
        a.state = 'standing'
      }
    } else if (act.type === 'work') {
      act.elapsed += simDelta
      const p = Math.min(1, act.elapsed / Math.max(act.simMs, 1))
      a.progress = p
      act.onProgress?.(p)
      if (p >= 1) {
        a.action = null
        a.task = ''
        a.progress = 0
        act.onDone?.()
      }
    }
    a.signal = a.x > 1270 ? 3 : 4
  }

  // ------------------------------------------------------------ read models for the UI
  zoneOf(a) {
    if (a.x < 300) return 'Outside'
    if (a.x > 1270) return 'Warehouse'
    if (a.y < 500) return a.x < 620 ? 'NOC' : 'North corridor'
    const row = [615, 775, 935, 1095, 1255].findIndex((y) => Math.abs(a.y - y) < 60)
    if (row >= 0) return `Row ${'ABCDE'[row]} aisle`
    return a.x < 400 ? 'West corridor' : a.x > 1190 ? 'East corridor' : 'Data hall'
  }

  counts() {
    const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]))
    for (const s of this.servers.values()) c[s.status]++
    return c
  }

  rackStatus(rackId) {
    let worst = 'healthy'
    for (let i = 1; i <= 8; i++) {
      const s = this.servers.get(`${rackId}-S${i}`)
      if (s && STATUS_ORDER.indexOf(s.status) < STATUS_ORDER.indexOf(worst)) worst = s.status
    }
    return worst
  }

  window() {
    return shiftWindow(new Date(this.simTime))
  }
}
