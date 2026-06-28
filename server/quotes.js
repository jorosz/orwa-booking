// ============================================================
// Quote-tár + naplózás — minden a `quote_requests` táblában (ugyanaz az orwa.db).
// Soronként EGY bejövő érdeklődés (a quote UUID a kulcs), amit a flow ahogy halad
// frissít: bejött a kérés → lett-e belőle foglalási kérelem → kiment-e az e-mail
// (sikeresen / sikertelenül). A teljes ajánlatot (`offers` JSON) is eltároljuk, így
// a /api/book a DB-ből veszi az árat — a kliens nem tudja hamisítani.
// ============================================================
'use strict'

import { db } from './db.js'

// ── Séma ─────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS quote_requests (
    id          TEXT PRIMARY KEY,   -- quote UUID
    ts          TEXT,               -- érdeklődés időbélyege (ISO)
    checkin     TEXT,
    checkout    TEXT,
    guests      INTEGER,
    nights      INTEGER,
    available   INTEGER,            -- volt-e egyáltalán szabad ajánlat (0/1)
    currency    TEXT,               -- a quote pénzneme ("EUR")
    offers      TEXT,               -- a kiadott ajánlatok JSON-ja (ár-hamisítás ellen)
    ip          TEXT,
    -- foglalási fázis (NULL/0 amíg nem lett foglalási kérelem) ──────────────
    booked      INTEGER DEFAULT 0,  -- lett-e belőle /api/book kérelem
    bookedAt    TEXT,               -- a foglalási kérelem időbélyege (ISO)
    name        TEXT,
    email       TEXT,
    phone       TEXT,
    lang        TEXT,
    -- e-mail kimenet ────────────────────────────────────────────────────────
    mailStatus  TEXT,               -- NULL (nem volt foglalás) | 'sent' | 'failed'
    mailError   TEXT                -- hibaüzenet, ha 'failed'
  )
`)

// Migráció: ha egy korábbi (offers/currency nélküli) tábla már létezik, pótoljuk.
const existingCols = new Set(db.prepare('PRAGMA table_info(quote_requests)').all().map(c => c.name))
for (const [name, decl] of [['currency', 'TEXT'], ['offers', 'TEXT']]) {
  if (!existingCols.has(name)) db.exec(`ALTER TABLE quote_requests ADD COLUMN ${name} ${decl}`)
}

// ── Quote-tár (a /api/book a DB-ből olvassa az árat) ─────────────────────────
const insertQuoteStmt = db.prepare(`
  INSERT OR REPLACE INTO quote_requests
    (id, ts, checkin, checkout, guests, nights, available, currency, offers, ip)
  VALUES
    (@id, @ts, @checkin, @checkout, @guests, @nights, @available, @currency, @offers, @ip)
`)

// Bejövő irányár-kérés tárolása + naplózása (/api/quote).
export function saveQuote(result, ip) {
  insertQuoteStmt.run({
    id: result.id,
    ts: new Date().toISOString(),
    checkin: result.checkin,
    checkout: result.checkout,
    guests: result.guests,
    nights: result.nights,
    available: result.available ? 1 : 0,
    currency: result.currency,
    offers: JSON.stringify(result.quote || []),
    ip: ip || null,
  })
}

const getQuoteStmt = db.prepare('SELECT * FROM quote_requests WHERE id = ?')

// A tárolt quote rekonstruálása a sorból (a /api/book + e-mail ebből dolgozik).
export function getQuote(id) {
  const r = getQuoteStmt.get(id)
  if (!r) return undefined
  return {
    id: r.id,
    available: !!r.available,
    checkin: r.checkin,
    checkout: r.checkout,
    guests: r.guests,
    nights: r.nights,
    currency: r.currency || 'EUR',
    quote: JSON.parse(r.offers || '[]'),
  }
}

const bookStmt = db.prepare(`
  UPDATE quote_requests SET
    booked = 1, bookedAt = @bookedAt,
    name = @name, email = @email, phone = @phone, lang = @lang
  WHERE id = @id
`)

// Foglalási kérelem naplózása (/api/book) — a kérésből foglalás lett.
export function logBooking(id, b, lang) {
  bookStmt.run({
    id,
    bookedAt: new Date().toISOString(),
    name: b.name,
    email: b.email,
    phone: b.phone,
    lang,
  })
}

const mailStmt = db.prepare(`
  UPDATE quote_requests SET mailStatus = @status, mailError = @error WHERE id = @id
`)

// E-mail kimenet naplózása (/api/book a küldés után).
export function logMailResult(id, ok, error) {
  mailStmt.run({ id, status: ok ? 'sent' : 'failed', error: ok ? null : (error || 'unknown') })
}
