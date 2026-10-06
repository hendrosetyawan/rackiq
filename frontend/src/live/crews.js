import { createAgentAvatarProfileFromSeed } from '../vendor/claw3d/avatarProfile'

// Three 8-hour shifts, each with 4 technicians and 1 superintendent (all fictional).
export const SHIFTS = [
  { id: 'A', name: 'Day', start: 6, color: '#facc15', crew: ['Ana Ruiz', 'Ben Okafor', 'Chen Wei', 'Dina Patel'], supt: 'Sam Morgan' },
  { id: 'B', name: 'Swing', start: 14, color: '#22d3ee', crew: ['Eli Novak', 'Farah Haddad', 'Gus Kim', 'Hana Sato'], supt: 'Rosa Alvarez' },
  { id: 'C', name: 'Night', start: 22, color: '#a78bfa', crew: ['Ivan Petrov', 'Jade Moreau', 'Kofi Mensah', 'Lena Berg'], supt: 'Tomas Reyes' },
]

export const shiftAt = (date) => {
  const h = date.getHours() + date.getMinutes() / 60
  if (h >= 6 && h < 14) return SHIFTS[0]
  if (h >= 14 && h < 22) return SHIFTS[1]
  return SHIFTS[2]
}

/** Start of the shift containing `date`, and of the next one. */
export const shiftWindow = (date) => {
  const s = shiftAt(date)
  const start = new Date(date)
  start.setMinutes(0, 0, 0)
  start.setHours(s.start)
  if (start > date) start.setDate(start.getDate() - 1)
  const end = new Date(start.getTime() + 8 * 3600_000)
  return { shift: s, start, end }
}

/** Claw3D avatar profile dressed for the floor: hi-vis tops and hard hats for
 *  technicians, a navy jacket + white hard hat + headset for the superintendent. */
export function appearanceFor(name, role, shift) {
  const p = createAgentAvatarProfileFromSeed(`${shift.id}-${name}`)
  if (role === 'superintendent') {
    p.clothing = { ...p.clothing, topStyle: 'jacket', topColor: '#1e3a8a', bottomStyle: 'pants', bottomColor: '#1f2937' }
    p.accessories = { ...p.accessories, hatStyle: 'helmet', hatColor: '#f8fafc', headset: true, backpack: false, glasses: true }
  } else {
    p.clothing = { ...p.clothing, topStyle: 'tee', topColor: '#f97316', bottomStyle: 'pants', bottomColor: '#334155' }
    p.accessories = { ...p.accessories, hatStyle: 'helmet', hatColor: shift.color, headset: false, backpack: false }
  }
  return p
}

// RackIQ Crew tracks a technician through whichever device they carry: a rugged
// tablet, the phone app (BYOD) or a smart ID badge read by the rack nodes' BLE anchors.
export const DEVICE = {
  tablet: { prefix: 'TAB', label: 'Rugged tablet', short: 'Tablet', drainPerH: 6 },
  phone: { prefix: 'PHN', label: 'Phone app', short: 'Phone', drainPerH: 4 },
  badge: { prefix: 'BDG', label: 'Smart ID badge', short: 'Badge', drainPerH: 0.02 },
}
const TECH_DEVICES = ['tablet', 'badge', 'phone', 'badge']
const deviceId = (kind, shift, n) => `${DEVICE[kind].prefix}-${shift.id}${n}`

export function crewFor(shift) {
  const members = shift.crew.map((name, i) => ({
    id: `${shift.id}-T${i + 1}`,
    name,
    role: 'technician',
    deviceKind: TECH_DEVICES[i],
    device: deviceId(TECH_DEVICES[i], shift, i + 1),
    color: '#f97316',
  }))
  members.push({ id: `${shift.id}-S`, name: shift.supt, role: 'superintendent', deviceKind: 'phone', device: deviceId('phone', shift, 'S'), color: '#3b82f6' })
  return members.map((m) => ({ ...m, shift: shift.id, appearance: appearanceFor(m.name, m.role, shift) }))
}
