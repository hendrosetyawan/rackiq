// 3D data hall for the live floor. Crew avatars are Claw3D's AgentModel
// (src/vendor/claw3d); the rack cabinets follow Claw3D's ServerRackModel design
// (dark cabinet, stacked 1U faceplates, a status LED per unit), instanced so all
// 100 racks / 800 servers draw in a handful of calls.
import { OrbitControls, Text } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { AgentModel } from '../vendor/claw3d/AgentModel'
import { SCENE_FONT } from '../vendor/claw3d/font'
import { toWorld } from '../vendor/claw3d/geometry'
import { STATE_COLOR } from '../lib/theme.js'
import { AISLE_Y, DOOR_Y, ENTRANCE, HALL, LANE_X, NOC, RACK_D, RACK_W, ROWS, ROW_X0, ROW_Y, WAREHOUSE, rackCenter } from './layout.js'
import { STATUS_COLOR } from './sim.js'

const S = 0.018
const RW = RACK_W * S
const RD = RACK_D * S
const RH = 1.3
const UNIT = 0.14
const unitY = (slot) => RH - 0.1 - (slot - 0.5) * UNIT
const W = (cx, cy, y = 0) => {
  const [x, , z] = toWorld(cx, cy)
  return [x, y, z]
}
const len = (canvas) => canvas * S

const tmpObj = new THREE.Object3D()
const tmpColor = new THREE.Color()
const DARK = new THREE.Color('#141c2c')
const BLINK = { failed: 3.2, critical: 1.6, maintenance: 0.8 }

// ------------------------------------------------------------------ racks
function Racks({ sim, selectedRack, onHover, onPick }) {
  const cabinets = useRef()
  const plates = useRef()
  const leds = useRef()
  const beacons = useRef()
  const columns = useRef()
  const kicks = useRef()
  const applied = useRef(-1)
  const blinking = useRef([])
  const racks = sim.racks
  const n = racks.length

  const pos = useMemo(() => racks.map((r) => {
    const c = rackCenter(r.row, r.pos)
    return W(c.x, c.y)
  }), [racks])

  useLayoutEffect(() => {
    racks.forEach((r, i) => {
      const [x, , z] = pos[i]
      const front = z + RD / 2
      tmpObj.rotation.set(0, 0, 0)
      tmpObj.scale.set(1, 1, 1)
      tmpObj.position.set(x, RH / 2, z)
      tmpObj.updateMatrix()
      cabinets.current.setMatrixAt(i, tmpObj.matrix)
      tmpObj.position.set(x, RH + 0.03, front - 0.06)
      tmpObj.updateMatrix()
      beacons.current.setMatrixAt(i, tmpObj.matrix)
      tmpObj.position.set(x, 0.035, front + 0.012)
      tmpObj.updateMatrix()
      kicks.current.setMatrixAt(i, tmpObj.matrix)
      kicks.current.setColorAt(i, tmpColor.set(r.state === 'normal' ? '#1f2a3d' : STATE_COLOR[r.state]))
    })
    cabinets.current.instanceMatrix.needsUpdate = true
    kicks.current.instanceMatrix.needsUpdate = true
    kicks.current.instanceColor.needsUpdate = true
    applied.current = -1
  }, [racks, pos])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (applied.current !== sim.statusVersion) {
      applied.current = sim.statusVersion
      const blink = []
      racks.forEach((r, i) => {
        const [x, , z] = pos[i]
        const front = z + RD / 2
        for (let slot = 1; slot <= 8; slot++) {
          const k = i * 8 + slot - 1
          const st = sim.servers.get(`${r.id}-S${slot}`)?.status ?? 'empty'
          const empty = st === 'empty'
          tmpObj.position.set(x, unitY(slot), front + 0.012)
          tmpObj.scale.setScalar(empty ? 0.0001 : 1)
          tmpObj.updateMatrix()
          plates.current.setMatrixAt(k, tmpObj.matrix)
          plates.current.setColorAt(k, tmpColor.copy(DARK).lerp(new THREE.Color(STATUS_COLOR[st]), st === 'offline' ? 0.25 : st === 'healthy' ? 0.28 : 0.6))
          tmpObj.position.set(x - RW / 2 + 0.1, unitY(slot), front + 0.03)
          tmpObj.updateMatrix()
          leds.current.setMatrixAt(k, tmpObj.matrix)
          leds.current.setColorAt(k, tmpColor.set(st === 'offline' ? '#1e293b' : STATUS_COLOR[st]))
          if (BLINK[st]) blink.push([k, st])
        }
        const worst = sim.rackStatus(r.id)
        beacons.current.setColorAt(i, tmpColor.set(STATUS_COLOR[worst === 'empty' || worst === 'offline' ? 'healthy' : worst]))
        tmpObj.position.set(x, RH + 1.2, z)
        tmpObj.scale.setScalar(worst === 'failed' ? 1 : 0.0001)
        tmpObj.updateMatrix()
        columns.current.setMatrixAt(i, tmpObj.matrix)
      })
      blinking.current = blink
      for (const m of [plates, leds, columns]) m.current.instanceMatrix.needsUpdate = true
      for (const m of [plates, leds, beacons]) m.current.instanceColor.needsUpdate = true
    }
    for (const [k, st] of blinking.current) {
      const on = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * BLINK[st])
      leds.current.setColorAt(k, tmpColor.set(STATUS_COLOR[st]).multiplyScalar(0.25 + 0.95 * on))
    }
    if (blinking.current.length) leds.current.instanceColor.needsUpdate = true
    columns.current.material.opacity = 0.16 + 0.1 * Math.sin(t * 5)
  })

  const rackFromEvent = (e) => (e.object === plates.current || e.object === leds.current ? Math.floor(e.instanceId / 8) : e.instanceId)
  const hover = (e) => {
    e.stopPropagation()
    const i = rackFromEvent(e)
    const slot = e.object === plates.current || e.object === leds.current ? (e.instanceId % 8) + 1 : null
    onHover({ kind: 'rack', id: racks[i].id, slot, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
  }
  const pick = (e) => {
    e.stopPropagation()
    onPick(racks[rackFromEvent(e)].id)
  }
  const handlers = { onPointerMove: hover, onPointerOut: () => onHover(null), onClick: pick }

  const sel = racks.findIndex((r) => r.id === selectedRack)
  return (
    <group>
      <instancedMesh ref={cabinets} args={[null, null, n]} {...handlers}>
        <boxGeometry args={[RW, RH, RD]} />
        <meshStandardMaterial color="#1a2131" metalness={0.45} roughness={0.55} />
      </instancedMesh>
      <instancedMesh ref={plates} args={[null, null, n * 8]} {...handlers}>
        <boxGeometry args={[RW - 0.09, UNIT - 0.025, 0.02]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={leds} args={[null, null, n * 8]} {...handlers}>
        <boxGeometry args={[0.07, 0.04, 0.014]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={beacons} args={[null, null, n]}>
        <boxGeometry args={[RW * 0.8, 0.05, 0.07]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={kicks} args={[null, null, n]}>
        <boxGeometry args={[RW, 0.07, 0.02]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={columns} args={[null, null, n]} raycast={() => null}>
        <cylinderGeometry args={[0.22, 0.34, 2.4, 16, 1, true]} />
        <meshBasicMaterial color="#ff2d55" transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </instancedMesh>
      {sel >= 0 && (
        <lineSegments position={[pos[sel][0], RH / 2, pos[sel][2]]}>
          <edgesGeometry args={[new THREE.BoxGeometry(RW + 0.08, RH + 0.08, RD + 0.08)]} />
          <lineBasicMaterial color="#22d3ee" />
        </lineSegments>
      )}
    </group>
  )
}

// ------------------------------------------------------------------ building
function useTileTexture(color, line, repeatX, repeatY) {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')
    g.fillStyle = color
    g.fillRect(0, 0, 64, 64)
    g.strokeStyle = line
    g.lineWidth = 2
    g.strokeRect(1, 1, 62, 62)
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeatX, repeatY)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [color, line, repeatX, repeatY])
}

function Plane({ x0, x1, y0, y1, color, opacity = 1, y = 0, map }) {
  const [cx, , cz] = W((x0 + x1) / 2, (y0 + y1) / 2)
  return (
    <mesh position={[cx, y, cz]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <planeGeometry args={[len(x1 - x0), len(y1 - y0)]} />
      <meshStandardMaterial color={map ? '#ffffff' : color} map={map} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} roughness={0.9} />
    </mesh>
  )
}

function Wall({ x0, y0, x1, y1, h = 0.55 }) {
  const [cx, , cz] = W((x0 + x1) / 2, (y0 + y1) / 2)
  const horiz = y0 === y1
  return (
    <mesh position={[cx, h / 2, cz]} raycast={() => null}>
      <boxGeometry args={[horiz ? len(x1 - x0) : 0.07, h, horiz ? 0.07 : len(y1 - y0)]} />
      <meshStandardMaterial color="#334155" transparent opacity={0.75} />
    </mesh>
  )
}

function Building() {
  const hallTiles = useTileTexture('#0e1626', '#18243a', (HALL.x1 - HALL.x0) / 33, (HALL.y1 - HALL.y0) / 33)
  const whFloor = useTileTexture('#1a1712', '#221e17', (WAREHOUSE.x1 - WAREHOUSE.x0) / 66, (WAREHOUSE.y1 - WAREHOUSE.y0) / 66)
  const doorHalf = 32
  return (
    <group>
      <Plane x0={0} x1={1800} y0={250} y1={1450} color="#05080f" y={-0.01} />
      <Plane {...HALL} map={hallTiles} />
      <Plane {...WAREHOUSE} map={whFloor} />
      {ROW_Y.map((y) => (
        <group key={y}>
          <Plane x0={ROW_X0 - 10} x1={ROW_X0 + 20 * 38 + 6} y0={y + RACK_D / 2} y1={y + RACK_D / 2 + 60} color="#1d4ed8" opacity={0.13} y={0.004} />
          <Plane x0={ROW_X0 - 10} x1={ROW_X0 + 20 * 38 + 6} y0={y - RACK_D / 2 - 55} y1={y - RACK_D / 2} color="#dc2626" opacity={0.08} y={0.004} />
        </group>
      ))}
      {/* warehouse walkway */}
      <Plane x0={LANE_X - 24} x1={LANE_X + 24} y0={470} y1={1260} color="#facc15" opacity={0.1} y={0.004} />
      <Plane x0={1270} x1={LANE_X} y0={DOOR_Y - 24} y1={DOOR_Y + 24} color="#facc15" opacity={0.1} y={0.004} />
      {/* hall walls, with the entrance (west) and the warehouse door (east) */}
      <Wall x0={HALL.x0} y0={HALL.y0} x1={WAREHOUSE.x1} y1={HALL.y0} />
      <Wall x0={HALL.x0} y0={HALL.y1} x1={WAREHOUSE.x1} y1={HALL.y1} />
      <Wall x0={HALL.x0} y0={HALL.y0} x1={HALL.x0} y1={ENTRANCE.y - doorHalf} />
      <Wall x0={HALL.x0} y0={ENTRANCE.y + doorHalf} x1={HALL.x0} y1={HALL.y1} />
      <Wall x0={HALL.x1} y0={HALL.y0} x1={HALL.x1} y1={DOOR_Y - doorHalf} />
      <Wall x0={HALL.x1} y0={DOOR_Y + doorHalf} x1={HALL.x1} y1={HALL.y1} />
      <Wall x0={WAREHOUSE.x1} y0={WAREHOUSE.y0} x1={WAREHOUSE.x1} y1={WAREHOUSE.y1} />
      {ROWS.map((r, i) => (
        <Text font={SCENE_FONT} key={r} position={W(ROW_X0 - 32, ROW_Y[i], 0.02)} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.6} color="#38bdf8" anchorX="center" anchorY="middle">
          {r}
        </Text>
      ))}
      {ROWS.map((r, i) => (
        <Text font={SCENE_FONT} key={`n${r}`} position={W(ROW_X0 + 20 * 38 + 22, AISLE_Y[i], 0.02)} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.2} color="#475569" anchorX="center" anchorY="middle">
          {`${r}01 – ${r}20`}
        </Text>
      ))}
      <Text font={SCENE_FONT} position={W(1455, 1275, 0.02)} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.36} color="#facc15" anchorX="center" anchorY="middle" fillOpacity={0.85}>
        SPARE PARTS WAREHOUSE
      </Text>
      <Text font={SCENE_FONT} position={W(ENTRANCE.x - 40, ENTRANCE.y + 40, 0.02)} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.2} color="#64748b" anchorX="center">
        ENTRANCE
      </Text>
      <Nocc />
    </group>
  )
}

function Nocc() {
  const [x, , z] = W(NOC.desk.x, NOC.desk.y)
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.38, 0]}>
        <boxGeometry args={[2.2, 0.05, 0.5]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[0, 0.18, -0.1]}>
        <boxGeometry args={[2.1, 0.36, 0.06]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      {[-0.7, 0, 0.7].map((dx) => (
        <group key={dx} position={[dx, 0.62, -0.08]}>
          <mesh>
            <boxGeometry args={[0.6, 0.36, 0.03]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
          <mesh position={[0, 0, 0.017]}>
            <planeGeometry args={[0.55, 0.31]} />
            <meshBasicMaterial color={dx === 0 ? '#0e7490' : '#1e3a8a'} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <Text font={SCENE_FONT} position={[0, 1.02, -0.08]} fontSize={0.16} color="#22d3ee" anchorX="center">
        NOC · RackIQ
      </Text>
    </group>
  )
}

// ------------------------------------------------------------------ warehouse
const stockColor = (s) => (s.onHand <= 0 ? '#ef4444' : s.onHand <= s.reorderPoint ? '#f97316' : '#22c55e')

function Bin({ s, selected, onPick }) {
  const [x, , z] = W(s.spot.shelfX, s.spot.y)
  const face = s.spot.left ? 1 : -1
  const depth = 0.6
  const width = 1.45
  const boxes = Math.min(s.onHand, 12)
  const col = stockColor(s)
  return (
    <group position={[x, 0, z]} onClick={(e) => (e.stopPropagation(), onPick(s.sku))}>
      {[0.05, 0.42, 0.79].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={[depth, 0.03, width]} />
          <meshStandardMaterial color="#475569" metalness={0.3} />
        </mesh>
      ))}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`${sx}${sz}`} position={[(sx * depth) / 2, 0.55, (sz * width) / 2]}>
          <boxGeometry args={[0.04, 1.1, 0.04]} />
          <meshStandardMaterial color="#1e40af" />
        </mesh>
      )))}
      {Array.from({ length: boxes }, (_, i) => {
        const level = Math.floor(i / 4)
        const k = i % 4
        return (
          <mesh key={i} position={[0, 0.07 + level * 0.37 + 0.12, -width / 2 + 0.2 + k * 0.35]}>
            <boxGeometry args={[0.36, 0.22, 0.28]} />
            <meshLambertMaterial color={i % 2 ? '#b08850' : '#c49a5c'} />
          </mesh>
        )
      })}
      <mesh position={[(face * depth) / 2 + face * 0.01, 1.18, 0]} rotation={[0, (face * Math.PI) / 2, 0]}>
        <planeGeometry args={[1.4, 0.38]} />
        <meshBasicMaterial color={selected ? '#0e7490' : '#0b1222'} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 1.12, 0]}>
        <boxGeometry args={[0.1, 0.06, width - 0.1]} />
        <meshBasicMaterial color={col} toneMapped={false} />
      </mesh>
      <Text font={SCENE_FONT} position={[(face * depth) / 2 + face * 0.02, 1.25, 0]} rotation={[0, (face * Math.PI) / 2, 0]} fontSize={0.105} color="#e2e8f0" anchorX="center" anchorY="middle">
        {`${s.sku}`}
      </Text>
      <Text font={SCENE_FONT} position={[(face * depth) / 2 + face * 0.02, 1.1, 0]} rotation={[0, (face * Math.PI) / 2, 0]} fontSize={0.095} color={col} anchorX="center" anchorY="middle">
        {`${s.bin} · ${s.onHand} on hand${s.inbound ? ` · +${s.inbound} PO` : ''}`}
      </Text>
    </group>
  )
}

function Warehouse({ stock, selectedSku, onPick }) {
  const inbound = stock.filter((s) => s.inbound > 0)
  return (
    <group>
      {stock.map((s) => <Bin key={s.sku} s={s} selected={s.sku === selectedSku} onPick={onPick} />)}
      {inbound.slice(0, 7).map((s, i) => {
        const [x, , z] = W(1300 + i * 46, 428)
        return (
          <group key={s.sku} position={[x, 0, z]}>
            <mesh position={[0, 0.05, 0]}>
              <boxGeometry args={[0.7, 0.1, 0.6]} />
              <meshLambertMaterial color="#8b6b3d" />
            </mesh>
            <mesh position={[0, 0.3, 0]}>
              <boxGeometry args={[0.6, 0.4, 0.5]} />
              <meshLambertMaterial color="#a3e635" transparent opacity={0.55} />
            </mesh>
          </group>
        )
      })}
      {inbound.length > 0 && (
        <Text font={SCENE_FONT} position={W(1300 + Math.min(inbound.length, 7) * 23 - 23, 462, 0.02)} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.15} color="#a3e635" anchorX="center">
          {`${inbound.length} PO${inbound.length > 1 ? 's' : ''} inbound`}
        </Text>
      )}
    </group>
  )
}

// ------------------------------------------------------------------ crew extras
function CrewMarkers({ agentsRef, selectedId }) {
  const ring = useRef()
  const line = useRef()
  const MAXP = 48
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3))
    return g
  }, [])
  useFrame(({ clock }) => {
    const a = agentsRef.current?.find((x) => x.id === selectedId)
    ring.current.visible = Boolean(a)
    line.current.visible = Boolean(a)
    if (!a) return
    const [x, , z] = W(a.x, a.y)
    ring.current.position.set(x, 0.02, z)
    ring.current.scale.setScalar(1 + 0.15 * Math.sin(clock.elapsedTime * 4))
    const path = a.action?.type === 'walk' ? a.action.path : []
    const buf = geo.attributes.position
    buf.setXYZ(0, x, 0.05, z)
    const n = Math.min(path.length, MAXP - 1)
    for (let i = 0; i < n; i++) {
      const [px, , pz] = W(path[i].x, path[i].y)
      buf.setXYZ(i + 1, px, 0.05, pz)
    }
    buf.needsUpdate = true
    geo.setDrawRange(0, n + 1)
    geo.computeBoundingSphere()
  })
  return (
    <>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[0.32, 0.4, 32]} />
        <meshBasicMaterial color="#22d3ee" toneMapped={false} transparent opacity={0.9} />
      </mesh>
      <line ref={line} geometry={geo}>
        <lineBasicMaterial color="#22d3ee" transparent opacity={0.8} />
      </line>
    </>
  )
}

function JobRings({ racks }) {
  const group = useRef()
  useFrame(({ clock }) => {
    group.current?.children.forEach((m, i) => {
      m.material.opacity = 0.35 + 0.3 * Math.sin(clock.elapsedTime * 3 + i)
    })
  })
  return (
    <group ref={group}>
      {racks.map((id) => {
        const c = rackCenter(id[0], Number(id.slice(1)))
        return (
          <mesh key={id} position={W(c.x, c.y + RACK_D / 2 + 22, 0.015)} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
            <ringGeometry args={[0.36, 0.46, 28]} />
            <meshBasicMaterial color="#3b82f6" transparent opacity={0.5} toneMapped={false} />
          </mesh>
        )
      })}
    </group>
  )
}

// ------------------------------------------------------------------ driver + camera
function SimDriver({ sim, agentsRef, lookupRef }) {
  useFrame((_, dt) => {
    sim.step(dt)
    agentsRef.current = sim.agents
    lookupRef.current = new Map(sim.agents.map((a) => [a.id, a]))
  })
  return null
}

const HOME_TARGET = new THREE.Vector3(...W(975, 880))
const HOME_CAM = new THREE.Vector3(...W(975, 1720, 20))

const CLOSE = new THREE.Vector3(0, 5.2, 6.2) // camera offset when zooming in on a person, rack or bin

function CameraRig({ agentsRef, followId, focus }) {
  const controls = useRef()
  const { camera } = useThree()
  const goal = useRef(null)
  const lastFocus = useRef(null)
  const lastFollow = useRef(null)
  const zoomIn = useRef(false)
  useFrame(() => {
    const c = controls.current
    if (!c) return
    if (focus && focus !== lastFocus.current) {
      lastFocus.current = focus
      goal.current = focus.home
        ? { target: HOME_TARGET.clone(), cam: HOME_CAM.clone() }
        : { target: new THREE.Vector3(...W(focus.x, focus.y)), zoom: true }
    }
    if (followId !== lastFollow.current) {
      lastFollow.current = followId
      zoomIn.current = Boolean(followId)
    }
    const a = followId && agentsRef.current?.find((x) => x.id === followId)
    let target = null
    if (a) target = new THREE.Vector3(...W(a.x, a.y))
    else if (goal.current) target = goal.current.target
    if (!target) return
    const prev = c.target.clone()
    c.target.lerp(target, 0.08)
    const zooming = a ? zoomIn.current : goal.current?.zoom
    const camGoal = goal.current?.cam && !a ? goal.current.cam : zooming ? target.clone().add(CLOSE) : null
    if (camGoal) {
      camera.position.lerp(camGoal, 0.06)
      if (camera.position.distanceTo(camGoal) < 0.15) {
        zoomIn.current = false
        if (!a && goal.current) goal.current.zoom = false
      }
    } else camera.position.add(c.target.clone().sub(prev))
    if (!a && goal.current && !goal.current.zoom && c.target.distanceTo(goal.current.target) < 0.02 && (!goal.current.cam || camera.position.distanceTo(goal.current.cam) < 0.15)) goal.current = null
    c.update()
  })
  return <OrbitControls ref={controls} makeDefault target={HOME_TARGET} maxPolarAngle={1.32} minDistance={3} maxDistance={42} enableDamping dampingFactor={0.1} />
}

// ------------------------------------------------------------------ scene
export default function DataHall({ sim, agentsRef, lookupRef, crew, stock, activeRacks, selected, followId, focus, onHover, onPickRack, onPickAgent, onPickSku }) {
  return (
    <Canvas camera={{ position: HOME_CAM.toArray(), fov: 38, near: 0.1, far: 200 }} dpr={[1, 1.75]} gl={{ antialias: true }} onPointerMissed={() => onHover(null)}>
      <color attach="background" args={['#05080f']} />
      <fog attach="fog" args={['#05080f', 30, 70]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#bcd7ff', '#0b1222', 0.6]} />
      <directionalLight position={[8, 16, 10]} intensity={1.1} />
      <SimDriver sim={sim} agentsRef={agentsRef} lookupRef={lookupRef} />
      <Suspense fallback={null}>
        <Building />
      </Suspense>
      <Racks sim={sim} selectedRack={selected?.kind === 'rack' ? selected.id : null} onHover={onHover} onPick={onPickRack} />
      <JobRings racks={activeRacks} />
      <Suspense fallback={null}>
        <Warehouse stock={stock} selectedSku={selected?.kind === 'sku' ? selected.id : null} onPick={onPickSku} />
      </Suspense>
      {crew.map((a) => (
        <Suspense key={a.id} fallback={null}>
        <AgentModel
          key={a.id}
          agentId={a.id}
          name={a.name}
          subtitle={a.role === 'superintendent' ? `Superintendent · ${a.device}` : a.device}
          status={a.battery < 15 ? 'error' : a.status}
          color={a.color}
          appearance={a.appearance}
          agentsRef={agentsRef}
          agentLookupRef={lookupRef}
          onClick={onPickAgent}
          showSpeech={a.speaking}
          speechText={a.speech}
        />
        </Suspense>
      ))}
      <CrewMarkers agentsRef={agentsRef} selectedId={selected?.kind === 'agent' ? selected.id : followId} />
      <CameraRig agentsRef={agentsRef} followId={followId} focus={focus} />
    </Canvas>
  )
}
