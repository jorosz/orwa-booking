// ============================================================
// ORWA Booking — egyesített backend (lásd SPEC.md). Egy Express app, egy porton
// (:8000), de KÉT jogosultsági szinttel, amit a PROXY-réteg választ szét path
// szerint (a service maga auth-mentes, mint a naptár volt):
//
//   PUBLIKUS  (orwa-new content-Caddy proxyzza, auth nélkül):
//     POST /api/quote   → irányár (EUR) + foglaltság (in-process DB-query)
//     POST /api/book    → foglalási kérelem e-mailben
//     GET  /healthz
//
//   ADMIN  (orwa-naptar Caddy proxyzza, basic_auth mögött):
//     GET  /api/bookings?year=&month=
//     POST /api/bookings
//     POST /api/bookings/:id
//     POST /api/bookings/:id/delete
//
// ⚠️ A content-Caddy SOHA nem proxyzhatja a /api/bookings* útvonalat — az csak a
//    naptár-proxyn át, auth mögött érhető el. Lásd SPEC §Biztonság.
// ============================================================
import express from 'express'
import crypto from 'node:crypto'

import {
  listMonth, createBooking, updateBooking, deleteBooking, findConflict,
  apartmentsFree, guestHouseFree,
} from './db.js'
import { priceOffers } from './pricing.js'
import { validateQuote, validateBook, ymd } from './validate.js'
import { saveQuote, getQuote, appendLog } from './quotes.js'
import { sendBookingMail } from './mail.js'

const app = express()
const PORT = process.env.PORT || 8000
app.use(express.json({ limit: '100kb' }))

// ── Health ───────────────────────────────────────────────────────────────────
app.get(['/healthz', '/api/healthz', '/api/health'], (req, res) => res.json({ ok: true }))

// ── PUBLIKUS: irányár + foglaltság ───────────────────────────────────────────
app.post('/api/quote', (req, res) => {
  const v = validateQuote(req.body)
  if (v.errors.length) return res.status(422).json({ errors: v.errors })

  const checkin = ymd(v.ci)
  const checkout = ymd(v.co)
  const avail = {
    apartmentsFree: apartmentsFree(checkin, checkout),
    guestHouseFree: guestHouseFree(checkin, checkout),
  }
  const offers = priceOffers(v.nights, v.guests, avail)

  const result = {
    id: crypto.randomUUID(),
    available: offers.length > 0,   // van-e egyáltalán szabad ajánlat
    checkin,
    checkout,
    guests: v.guests,
    nights: v.nights,
    currency: 'EUR',
    quote: offers,
  }
  saveQuote(result)
  appendLog({ event: 'quote', id: result.id, checkin, checkout, guests: v.guests, nights: v.nights, available: result.available, ip: req.ip })
  res.json(result)
})

// ── PUBLIKUS: foglalási kérelem (e-mail) ─────────────────────────────────────
app.post('/api/book', async (req, res) => {
  const lang = /^[a-z]{2}$/.test(String(req.body.lang || '')) ? req.body.lang : 'hu'
  const v = validateBook(req.body)
  if (v.errors.length) return res.status(422).json({ errors: v.errors })

  const q = req.body.id && getQuote(String(req.body.id))
  if (!q) return res.status(422).json({ errors: [{ field: 'checkin', code: 'errCheckin' }] })

  appendLog({ event: 'book', id: String(req.body.id), name: v.name, email: v.email, phone: v.phone, lang })

  try {
    await sendBookingMail(q, v, lang)
  } catch (e) {
    console.error('[book] mail error:', e && e.message)
    return res.status(500).json({ success: false, error: 'mail' })
  }
  res.json({ success: true })
})

// ── ADMIN: foglalások (a naptár-frontend hívja, auth mögött) ─────────────────
app.get('/api/bookings', (req, res) => {
  const year = Number(req.query.year)
  const month = Number(req.query.month) // 1–12
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: 'year és month (1–12) kötelező' })
  }
  res.json(listMonth(year, month))
})

app.post('/api/bookings', (req, res) => {
  const data = req.body
  const conflict = findConflict(data.accommodation, data.arrival, data.departure)
  if (conflict) return res.status(409).json({ conflict })
  res.json(createBooking(data))
})

app.post('/api/bookings/:id', (req, res) => {
  const id = Number(req.params.id)
  const data = req.body
  const conflict = findConflict(data.accommodation, data.arrival, data.departure, id)
  if (conflict) return res.status(409).json({ conflict })
  const updated = updateBooking(id, data)
  if (!updated) return res.status(404).json({ error: 'Nincs ilyen foglalás' })
  res.json(updated)
})

app.post('/api/bookings/:id/delete', (req, res) => {
  const id = Number(req.params.id)
  const deleted = deleteBooking(id)
  if (!deleted) return res.status(404).json({ error: 'Nincs ilyen foglalás' })
  res.json(deleted)
})

app.listen(PORT, () => {
  console.log(`ORWA booking backend listening on :${PORT}`)
})
