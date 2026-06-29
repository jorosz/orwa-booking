// ============================================================
// Validáció — a quote/book bemenetre. A hibakódok a kliens i18n-kulcsai (`err*`),
// így a frontend fordítja őket. (A sidecar server.js validációjának portja.)
// ============================================================
'use strict'

// Validációs korlátok EGY helyen: server/config.js (LIMITS).
import { LIMITS } from './config.js'

const DAY = 86400000
const addDays = (d, n) => new Date(d.getTime() + n * DAY)
export const ymd = (d) => d.toISOString().slice(0, 10)

function parseDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s + 'T00:00:00Z')
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null
  return d
}
function todayUTC() {
  const n = new Date()
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()))
}

export function validateQuote(input) {
  const errors = []
  const today = todayUTC()
  const ci = parseDate(input && input.checkin)
  const co = parseDate(input && input.checkout)

  if (!ci) {
    errors.push({ field: 'checkin', code: 'errCheckin' })
  } else if (ci < today) {
    errors.push({ field: 'checkin', code: 'errPast' })
  } else if (ci < addDays(today, LIMITS.minAdvanceDays)) {
    errors.push({ field: 'checkin', code: 'errMinAdvance', vars: { n: LIMITS.minAdvanceDays } })
  } else if (ci > addDays(today, LIMITS.maxAdvanceDays)) {
    errors.push({ field: 'checkin', code: 'errHorizon' })
  }

  let nights = 0
  if (!co) {
    errors.push({ field: 'checkout', code: 'errCheckout' })
  } else if (ci) {
    nights = Math.round((co - ci) / DAY)
    if (nights <= 0) {
      errors.push({ field: 'checkout', code: 'errOrder' })
    } else if (nights < LIMITS.minNights) {
      errors.push({ field: 'checkout', code: 'errMinNights', vars: { n: LIMITS.minNights } })
    } else if (nights > LIMITS.maxNights) {
      errors.push({ field: 'checkout', code: 'errMaxNights', vars: { n: LIMITS.maxNights } })
    }
  }

  const g = Number(input && input.guests)
  if (!Number.isInteger(g) || g < 1) {
    errors.push({ field: 'guests', code: 'errGuests' })
  } else if (g > LIMITS.maxGuests) {
    errors.push({ field: 'guests', code: 'errMaxGuests', vars: { n: LIMITS.maxGuests } })
  }

  return { errors, ci, co, nights, guests: g }
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function validateBook(input) {
  const errors = []
  const name = String((input && input.name) || '').trim()
  const email = String((input && input.email) || '').trim()
  const email2 = String((input && input.email2) || '').trim()
  const phone = String((input && input.phone) || '').trim()

  if (name.length < 2) errors.push({ field: 'name', code: 'errName' })
  if (!emailRe.test(email)) errors.push({ field: 'email', code: 'errEmail' })
  if (email !== email2) errors.push({ field: 'email2', code: 'errEmailMatch' })
  if (!/^[0-9+\-\s]{8,}$/.test(phone)) errors.push({ field: 'phone', code: 'errPhone' })

  // Opcionális mezők — nem validálási hiba, csak sanitizálás:
  //   note: szabad szöveg (egyéb megjegyzés / különleges kérés), max 2000 karakter.
  //   preferred: a megjelölt ajánlat indexe az offers tömbben (≥0 egész, vagy null).
  //   A tartomány-ellenőrzést (index < offers.length) a hívó végzi, ahol a tárolt
  //   quote elérhető — érvénytelen indexet ott figyelmen kívül hagyunk.
  const note = String((input && input.note) || '').trim().slice(0, 2000)
  const p = input && input.preferred
  const preferred = Number.isInteger(p) && p >= 0 ? p : null

  return { errors, name, email, phone, note, preferred }
}
