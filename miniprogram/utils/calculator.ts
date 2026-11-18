// utils/calculator.ts
// 羽毛球 AA 计算核心（纯函数，不依赖任何 DOM / 浏览器 API）

const SEP = '-~—–至到'
const seqRe = /^\s*(\d+)\s*[.、．]\s*(.+?)\s*$/

export interface ExtraInput {
  name: string
  amount: string
  mode: 'perPerson' | 'perPayer'
}

export interface CalcInput {
  roster: string
  duration: number
  startHour: string
  fees: string[]
  extras: ExtraInput[]
}

export interface Chip {
  text: string
  cls: string
}

export interface PersonRow {
  name: string
  avatar: string
  amountText: string
  sub: string
  chips: Chip[]
}

export interface SlotCard {
  label: string
  time: string
  feeText: string
  shareText: string
  whoChips: string[]
  cls: string
}

export interface ExtraLine {
  left: string
  right: string
}

export interface CalcResult {
  total: string
  people: number
  payers: number
  peopleText: string
  payersText: string
  personRows: PersonRow[]
  slotCards: SlotCard[]
  extraLines: ExtraLine[]
  showExtras: boolean
}

export type CalcOutcome =
  | { ok: true; data: CalcResult }
  | { ok: false; error: string }

export const money = (n: number): string =>
  '¥' + (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2)

interface SessionInfo {
  sessionStart: number
  clockHours: number[]
  clockPoints: number[]
  nextClockHour: (h: number) => number
}

interface Person {
  name: string
  payerKey: string
  slots: number[]
  guest: boolean
}

interface Payer {
  key: string
  name: string
  displayName: string
  amount: number
  parts: { key: string; share: number; person: string }[]
}

interface Parsed {
  people: Person[]
  payers: Payer[]
  issues: string[]
  session: SessionInfo
}

function looksLikeRoster(line: string): boolean {
  const m = line.match(seqRe)
  if (!m) return false
  const raw = m[2]
  if (/^\d+\s*\.\s*\d/.test(raw)) return false
  if (/周[一二三四五六日天]/.test(raw) &&
      new RegExp('\\d{1,2}\\s*[' + SEP + ']\\s*\\d{1,2}').test(raw)) return false
  return true
}

function getSessionInfo(text: string, count: number, manualStart: string): SessionInfo {
  const lines = text.split(/\r?\n/)
  let cut = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (looksLikeRoster(lines[i])) { cut = i; break }
  }
  let start = 12
  const manual = manualStart.trim()
  if (manual !== '' && Number.isFinite(Number(manual))) {
    start = Number(manual)
  } else {
    const header = lines.slice(0, cut).join('\n').match(
      new RegExp('(\\d{1,2})\\s*[:：]\\s*\\d{2}\\s*[' + SEP + ']+\\s*(\\d{1,2})\\s*[:：]?\\s*\\d{0,2}|(\\d{1,2})\\s*[' + SEP + ']+\\s*(\\d{1,2})\\s*点?'))
    if (header) start = Number(header[1] || header[3])
  }
  const is12h = start >= 1 && start <= 12
  const clockHours = Array.from({ length: count }, (_, i) => is12h
    ? ((start - 1 + i) % 12) + 1
    : (start + i) % 24)
  const nextClockHour = (h: number): number => is12h ? (h === 12 ? 1 : h + 1) : (h + 1) % 24
  const clockPoints = clockHours.concat([nextClockHour(clockHours[count - 1])])
  return { sessionStart: start, clockHours, clockPoints, nextClockHour }
}

function extractRange(inner: string): [number, number] | null {
  const colon = inner.match(
    new RegExp('(\\d{1,2})\\s*[:：]\\s*\\d{2}\\s*[' + SEP + ']+\\s*(\\d{1,2})\\s*[:：]?\\s*\\d{0,2}'))
  if (colon) return [Number(colon[1]), Number(colon[2])]
  const norm = inner.replace(/[点时]/g, '').replace(/\s+/g, '')
  const m = norm.match(new RegExp('(\\d{1,2})[' + SEP + ']+(\\d{1,2})'))
  return m ? [Number(m[1]), Number(m[2])] : null
}

function parseRoster(text: string, count: number, session: SessionInfo): Parsed {
  const lines = text.split(/\r?\n/)
  const people: Person[] = []
  const payers = new Map<string, Payer>()
  const lastByName = new Map<string, string>()
  const issues: string[] = []
  const allSlots = Array.from({ length: count }, (_, i) => i)
  const clockIndex = (h: number): number => session.clockPoints.findIndex(x => x === h)

  function slotsFrom(raw: string): number[] | null {
    const b = raw.match(/[（(]([^）)]*)[）)]/)
    if (!b) return allSlots.slice()
    const inner = b[1].trim()
    if (/^(全场|全程|整场)$/.test(inner)) return allSlots.slice()
    const range = extractRange(inner)
    if (!range) return /\d/.test(inner) ? null : allSlots.slice()
    const a = clockIndex(range[0])
    const z = clockIndex(range[1])
    if (a < 0 || z < 0 || z <= a) return null
    const out: number[] = []
    for (let i = a; i < z && i < count; i++) if (i >= 0) out.push(i)
    return out.length ? out : null
  }

  const cleanName = (s: string): string =>
    s.replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, ' ').trim()

  function parseCount(namePart: string): { owner: string; count: number } | null {
    let m = namePart.match(/^(.+?)\s*(?:\+|加|带)\s*(\d+)\s*(?:人|位|个)?\s*$/)
    if (m) return { owner: m[1].trim(), count: Number(m[2]) }
    m = namePart.match(/^(.+?)\s+(\d+)\s*(?:人|位|个)\s*$/)
    if (m) return { owner: m[1].trim(), count: Number(m[2]) }
    return null
  }

  let expectedSeq = 1
  lines.forEach((line, idx) => {
    if (!looksLikeRoster(line)) return
    const matched = line.match(seqRe)
    if (!matched) return
    const seq = Number(matched[1])
    if (seq !== expectedSeq) return
    expectedSeq++
    const raw = matched[2]
    const slots = slotsFrom(raw)
    if (!slots) {
      issues.push(`第 ${idx + 1} 行「${raw}」时段无法识别，请写成（1-3点）或（12:00-15:00）等场次内的时间。`)
      return
    }
    const namePart = cleanName(raw)
    const plus = parseCount(namePart)
    if (plus) {
      const owner = plus.owner
      if (!owner) {
        issues.push(`第 ${idx + 1} 行没有识别到 +1 归属人。`)
        return
      }
      let ownerKey = lastByName.get(owner)
      if (ownerKey == null) {
        ownerKey = 'payer-' + idx
        payers.set(ownerKey, { key: ownerKey, name: owner, displayName: owner, amount: 0, parts: [] })
        lastByName.set(owner, ownerKey)
      }
      const n = Math.max(1, Math.min(20, plus.count))
      for (let i = 0; i < n; i++) {
        people.push({
          name: owner + '的+' + n + '人' + (n > 1 ? `(${i + 1})` : ''),
          payerKey: ownerKey, slots: slots.slice(), guest: true
        })
      }
    } else {
      if (!namePart) return
      const key = 'payer-' + idx
      payers.set(key, { key, name: namePart, displayName: namePart, amount: 0, parts: [] })
      lastByName.set(namePart, key)
      people.push({ name: namePart, payerKey: key, slots: slots.slice(), guest: false })
    }
  })

  const payersArray = Array.from(payers.values())
  const nameCount: Record<string, number> = {}
  const nameSeen: Record<string, number> = {}
  payersArray.forEach(p => { nameCount[p.name] = (nameCount[p.name] || 0) + 1 })
  payersArray.forEach(p => {
    nameSeen[p.name] = (nameSeen[p.name] || 0) + 1
    p.displayName = nameCount[p.name] > 1 ? `${p.name}(${nameSeen[p.name]})` : p.name
  })
  return { people, payers: payersArray, issues, session }
}

export function calculateFeeLabels(roster: string, duration: number, startHour: string): string[] {
  const info = getSessionInfo(roster, duration, startHour)
  return info.clockHours.map((h, i) =>
    `第 ${i + 1} 时段 ${h}:00–${info.nextClockHour(h)}:00`)
}

export function runCalculation(input: CalcInput): CalcOutcome {
  const { roster, duration, startHour } = input
  const feesRaw = input.fees.slice(0, duration)
  const fees: number[] = []
  for (let i = 0; i < duration; i++) {
    const v = (feesRaw[i] || '').trim()
    if (v === '' || !Number.isFinite(Number(v)) || Number(v) < 0) {
      return { ok: false, error: '请填写每个时段的场地费，金额不能小于 0。' }
    }
    fees.push(Number(v))
  }

  const extras = input.extras
    .filter(e => (e.amount || '').trim() !== '')
    .map(e => ({
      name: (e.name || '').trim() || '额外费用',
      amount: Number(e.amount),
      mode: e.mode
    }))
  if (extras.some(e => !Number.isFinite(e.amount) || e.amount < 0)) {
    return { ok: false, error: '额外费用金额必须是大于或等于 0 的数字。' }
  }

  const session = getSessionInfo(roster, duration, startHour)
  const parsed = parseRoster(roster, duration, session)
  const { people, payers, issues } = parsed
  if (issues.length) {
    return {
      ok: false,
      error: issues[0] + (issues.length > 1 ? `（另有 ${issues.length - 1} 处同样问题）` : '')
    }
  }
  if (!people.length) {
    return { ok: false, error: '没有识别到名单。请使用“1. 姓名”格式，且序号从 1 开始。' }
  }

  const slotPeople: Person[][] = Array.from({ length: duration }, () => [])
  people.forEach(p => p.slots.forEach(s => { if (s >= 0 && s < duration) slotPeople[s].push(p) }))
  const findPayer = (p: Person): Payer => payers.filter(x => x.key === p.payerKey)[0]

  for (let s = 0; s < duration; s++) {
    if (!slotPeople[s].length && fees[s] > 0) {
      return { ok: false, error: `第 ${s + 1} 时段有场地费但无人参与，请检查名单或时段。` }
    }
    if (slotPeople[s].length) {
      const share = fees[s] / slotPeople[s].length
      slotPeople[s].forEach(p => {
        const payer = findPayer(p)
        payer.amount += share
        payer.parts.push({ key: 'slot-' + s, share, person: p.name })
      })
    }
  }

  extras.forEach((ex, i) => {
    if (ex.amount === 0) return
    if (ex.mode === 'perPayer') {
      const share = ex.amount / payers.length
      payers.forEach(p => {
        p.amount += share
        p.parts.push({ key: 'extra-' + i, share, person: p.displayName })
      })
    } else {
      const share = ex.amount / people.length
      people.forEach(p => {
        const payer = findPayer(p)
        payer.amount += share
        payer.parts.push({ key: 'extra-' + i, share, person: p.name })
      })
    }
  })

  const totalAmount = fees.reduce((a, b) => a + b, 0) + extras.reduce((a, e) => a + e.amount, 0)
  const totalCents = Math.round(totalAmount * 100)
  const rawCents = payers.map(p => p.amount * 100)
  const base = rawCents.map(x => Math.floor(x + 1e-9))
  let remain = totalCents - base.reduce((a, b) => a + b, 0)
  const order = payers
    .map((_, i) => ({ i, frac: rawCents[i] - base[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  if (remain > 0) {
    for (let k = 0; k < remain; k++) base[order[k % order.length].i]++
  } else if (remain < 0) {
    for (let k = order.length - 1; remain < 0; k = (k - 1 + order.length) % order.length, remain++) {
      base[order[k].i]--
    }
  }
  const rounded = base.map(c => c / 100)

  const keyLabel = (key: string): string => {
    if (key.indexOf('slot-') === 0) {
      const s = Number(key.slice(5))
      return `${session.clockHours[s]}-${session.nextClockHour(session.clockHours[s])}点`
    }
    return extras[Number(key.slice(6))].name
  }

  const personRows: PersonRow[] = payers.map((p, i) => {
    const grouped = new Map<string, { count: number; sum: number }>()
    p.parts.forEach(part => {
      if (!grouped.has(part.key)) grouped.set(part.key, { count: 0, sum: 0 })
      const g = grouped.get(part.key) as { count: number; sum: number }
      g.count++
      g.sum += part.share
    })
    const chips: Chip[] = Array.from(grouped.entries()).map(([key, g]) => {
      const isExtra = key.indexOf('extra-') === 0
      const slotIdx = isExtra ? -1 : Number(key.slice(5))
      return {
        text: `${keyLabel(key)} · ${g.count}份 ${money(g.sum / g.count)} = ${money(g.sum)}`,
        cls: isExtra ? 'extra' : 's' + (slotIdx % 6)
      }
    })
    const nParts = p.parts.filter(x => x.key.indexOf('slot-') === 0).length
    return {
      name: p.displayName,
      avatar: p.displayName.charAt(0),
      amountText: money(rounded[i]),
      sub: `参与 ${nParts} 个时段份额 · 共 ${p.parts.length} 笔`,
      chips
    }
  })

  const slotCards: SlotCard[] = []
  for (let s = 0; s < duration; s++) {
    const who = Array.from(new Set(slotPeople[s].map(p =>
      p.name.replace(/的\+\d+人.*/, '（+1）'))))
    slotCards.push({
      label: `第 ${s + 1} 时段`,
      time: `${session.clockHours[s]}:00 – ${session.nextClockHour(session.clockHours[s])}:00`,
      feeText: `场地费 ${money(fees[s])}`,
      shareText: slotPeople[s].length
        ? `${slotPeople[s].length} 人 · 每人 ${money(fees[s] / slotPeople[s].length)}`
        : '无人参与',
      whoChips: who,
      cls: 's' + (s % 6)
    })
  }

  const extraLines: ExtraLine[] = extras.filter(e => e.amount > 0).map(ex => {
    const n = ex.mode === 'perPayer' ? payers.length : people.length
    return {
      left: `${ex.name}（${ex.mode === 'perPayer' ? '按收款人' : '按人次'}）${n} 份`,
      right: `${money(ex.amount)} ÷ ${n} = ${money(ex.amount / n)}/份`
    }
  })

  return {
    ok: true,
    data: {
      total: money(totalAmount),
      people: people.length,
      payers: payers.length,
      peopleText: String(people.length),
      payersText: String(payers.length),
      personRows,
      slotCards,
      extraLines,
      showExtras: extraLines.length > 0
    }
  }
}
