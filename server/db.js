// ============================================================
// Adatréteg — better-sqlite3, egyetlen `bookings` tábla.
// A naptár (orwa-naptar/server/db.js) portja: a séma, a CRUD, az ütközés-
// ellenőrzés és a log-diff változatlanul. ÚJ: szétválasztott elérhetőség
// (apartman vs. vendégház), amit a quote-árazás in-process hív (nincs többé
// HTTP-hop a naptár felé).
// ============================================================
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Konténerben mountolt volume-ra mutat (DB_PATH=/data/orwa.db); lokálban a
// server/orwa.db az alapértelmezett. A WAL-fájlok (-wal, -shm) mellé kerülnek.
const dbPath = process.env.DB_PATH || path.join(__dirname, 'orwa.db')

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

// ── Séma ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id            INTEGER PRIMARY KEY,
    accommodation INTEGER,        -- 0: Vendégház | 1–8: Apartman 1–8
    guestName     TEXT,
    guests        INTEGER,
    arrival       TEXT,           -- ISO dátum, pl. "2026-06-08"
    departure     TEXT,           -- ISO dátum, a kijelentkezés napja
    price         INTEGER,
    currency      TEXT,           -- "HUF" | "EUR"
    deposit       INTEGER,        -- NULL, ha nincs előleg
    email         TEXT,
    phone         TEXT,
    comment       TEXT,
    status        TEXT,           -- "confirmed" | "tentative"
    deleted       INTEGER DEFAULT 0,
    createdAt     TEXT,
    log           TEXT            -- JSON tömb: [{ timestamp, message }]
  )
`)

// ── Megjelenítés / log-szöveg segédek ────────────────────────────────────────
const monthsAbbr = ['jan.', 'feb.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.']
const currencySymbol = { HUF: 'Ft', EUR: '€' }
const statusLabel = { confirmed: 'megerősített', tentative: 'opciós' }
const accNames = ['Vendégház', 'Apartman 1', 'Apartman 2', 'Apartman 3', 'Apartman 4', 'Apartman 5', 'Apartman 6', 'Apartman 7', 'Apartman 8']
const accName = i => accNames[i] ?? ('#' + i)
const pad = n => ('' + n).padStart(2, '0')

function stamp() {
  const n = new Date()
  return `${n.getFullYear()}.${pad(n.getMonth() + 1)}.${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}`
}
function fmtShort(iso) {
  const [, m, d] = iso.split('-').map(Number)
  return `${monthsAbbr[m - 1]} ${d}.`
}
function fmtPrice(p, currency) {
  if (p == null || p === '') return '—'
  return Number(p).toLocaleString('hu-HU') + ' ' + (currencySymbol[currency] || currency)
}

function rowOut(row) {
  if (!row) return row
  return { ...row, log: JSON.parse(row.log || '[]') }
}

// ── Ütközés-ellenőrzés ───────────────────────────────────────────────────────
// meglévő.arrival < új.departure ÉS meglévő.departure > új.arrival
// → a kiköltözés napjára másik vendég becsekkolhat (nem ütközés).
const conflictStmt = db.prepare(`
  SELECT * FROM bookings
  WHERE deleted = 0 AND accommodation = @accommodation AND id != @exceptId
    AND arrival < @departure AND departure > @arrival
  LIMIT 1
`)
export function findConflict(accommodation, arrival, departure, exceptId = -1) {
  return rowOut(conflictStmt.get({ accommodation, arrival, departure, exceptId }))
}

// ── Lekérdezések ─────────────────────────────────────────────────────────────
const byIdStmt = db.prepare('SELECT * FROM bookings WHERE id = ?')
export function getById(id) {
  return rowOut(byIdStmt.get(id))
}

const monthStmt = db.prepare(`
  SELECT * FROM bookings
  WHERE arrival < @afterLast AND departure >= @first
  ORDER BY id
`)
export function listMonth(year, month) {
  const first = `${year}-${pad(month)}-01`
  const ny = month === 12 ? year + 1 : year
  const nm = month === 12 ? 1 : month + 1
  const afterLast = `${ny}-${pad(nm)}-01`
  return monthStmt.all({ first, afterLast }).map(rowOut)
}

const insertStmt = db.prepare(`
  INSERT INTO bookings
    (accommodation, guestName, guests, arrival, departure, price, currency,
     deposit, email, phone, comment, status, deleted, createdAt, log)
  VALUES
    (@accommodation, @guestName, @guests, @arrival, @departure, @price, @currency,
     @deposit, @email, @phone, @comment, @status, 0, @createdAt, @log)
`)
export function createBooking(data) {
  const log = [{ timestamp: stamp(), message: 'Foglalás rögzítve – ' + (statusLabel[data.status] || data.status) }]
  const info = insertStmt.run({
    accommodation: data.accommodation,
    guestName: data.guestName,
    guests: data.guests,
    arrival: data.arrival,
    departure: data.departure,
    price: data.price,
    currency: data.currency,
    deposit: data.deposit ?? null,
    email: data.email ?? '',
    phone: data.phone ?? '',
    comment: data.comment ?? '',
    status: data.status,
    createdAt: stamp(),
    log: JSON.stringify(log),
  })
  return getById(info.lastInsertRowid)
}

const updateStmt = db.prepare(`
  UPDATE bookings SET
    accommodation = @accommodation, guestName = @guestName, guests = @guests,
    arrival = @arrival, departure = @departure, price = @price, currency = @currency,
    deposit = @deposit, email = @email, phone = @phone, comment = @comment,
    status = @status, log = @log
  WHERE id = @id
`)
export function updateBooking(id, data) {
  const b = getById(id)
  if (!b) return null
  // Log-diff: az összes változás EGY időbélyeges bejegyzésbe, ` · ` szeparátorral.
  const log = b.log
  const changes = []
  if (b.status !== data.status) changes.push('Státusz: ' + statusLabel[b.status] + ' → ' + statusLabel[data.status])
  if (b.price !== data.price || b.currency !== data.currency)
    changes.push('Ár: ' + fmtPrice(b.price, b.currency) + ' → ' + fmtPrice(data.price, data.currency))
  if (b.arrival !== data.arrival) changes.push('Érkezés: ' + fmtShort(b.arrival) + ' → ' + fmtShort(data.arrival))
  if (b.departure !== data.departure) changes.push('Távozás: ' + fmtShort(b.departure) + ' → ' + fmtShort(data.departure))
  const newDeposit = data.deposit || null
  if ((b.deposit || null) !== newDeposit)
    changes.push(newDeposit ? 'Előleg rögzítve: ' + fmtPrice(newDeposit, data.currency) : 'Előleg törölve')
  if (b.accommodation !== data.accommodation)
    changes.push('Szállás: ' + accName(b.accommodation) + ' → ' + accName(data.accommodation))
  if (b.guestName !== data.guestName)
    changes.push('Név: ' + b.guestName + ' → ' + data.guestName)
  if (b.guests !== data.guests)
    changes.push('Vendégszám: ' + b.guests + ' → ' + data.guests + ' fő')
  if ((b.email || '') !== (data.email || ''))
    changes.push('E-mail: ' + (b.email || '—') + ' → ' + (data.email || '—'))
  if ((b.phone || '') !== (data.phone || ''))
    changes.push('Telefon: ' + (b.phone || '—') + ' → ' + (data.phone || '—'))
  if ((b.comment || '') !== (data.comment || ''))
    changes.push('Megjegyzés frissítve')
  if (changes.length) log.push({ timestamp: stamp(), message: changes.join(' · ') })

  updateStmt.run({
    id,
    accommodation: data.accommodation,
    guestName: data.guestName,
    guests: data.guests,
    arrival: data.arrival,
    departure: data.departure,
    price: data.price,
    currency: data.currency,
    deposit: data.deposit ?? null,
    email: data.email ?? '',
    phone: data.phone ?? '',
    comment: data.comment ?? '',
    status: data.status,
    log: JSON.stringify(log),
  })
  return getById(id)
}

const deleteStmt = db.prepare('UPDATE bookings SET deleted = 1, log = @log WHERE id = @id')
export function deleteBooking(id) {
  const b = getById(id)
  if (!b) return null
  b.log.push({ timestamp: stamp(), message: 'Foglalás törölve' })
  deleteStmt.run({ id, log: JSON.stringify(b.log) })
  return getById(id)
}

// ── Elérhetőség (a quote-árazás hívja, in-process) ───────────────────────────
// Szétválasztva apartman (1–8) és vendégház (0). Átfedés-feltétel:
//   arrival < checkout ÉS departure > checkin (a törölteket kihagyjuk).
// Nem 100%-os pontosság a cél (lásd SPEC §árazás) — a foglalt egységek durva
// számából dolgozunk; ha 8-ból 2 szabad, lehet hogy az ajánlatban 3-at írunk.
const aptBusyStmt = db.prepare(`
  SELECT COUNT(DISTINCT accommodation) AS busy FROM bookings
  WHERE deleted = 0 AND accommodation BETWEEN 1 AND 8
    AND arrival < @checkout AND departure > @checkin
`)
export function apartmentsFree(checkin, checkout) {
  return 8 - aptBusyStmt.get({ checkin, checkout }).busy
}

const houseBusyStmt = db.prepare(`
  SELECT COUNT(*) AS busy FROM bookings
  WHERE deleted = 0 AND accommodation = 0
    AND arrival < @checkout AND departure > @checkin
  LIMIT 1
`)
export function guestHouseFree(checkin, checkout) {
  return houseBusyStmt.get({ checkin, checkout }).busy === 0
}

// ── Seed: a prototípus 31 demo-foglalása (env-vezérelt, csak üres táblára) ────
const SEED = [
  { accommodation: 1, arrival: '2026-06-03', departure: '2026-06-07', guestName: 'Kovács Béla',    guests: 2, status: 'confirmed', price: 48000,  currency: 'HUF', email: 'kovacs.bela@gmail.com',   phone: '+36 30 214 7782', comment: '' },
  { accommodation: 1, arrival: '2026-06-12', departure: '2026-06-19', guestName: 'Nagy Anikó',     guests: 4, status: 'confirmed', price: 112000, currency: 'HUF', email: 'nagy.aniko@freemail.hu',  phone: '+36 20 553 1140', comment: 'Két gyerek, gyerekágy kérése.', log: [{ timestamp: '2026.03.21 14:08', message: 'Foglalás rögzítve – megerősített' }, { timestamp: '2026.04.10 08:55', message: 'Megjegyzés frissítve: gyerekágy kérése' }] },
  { accommodation: 1, arrival: '2026-06-24', departure: '2026-06-28', guestName: 'Szabó Tamás',    guests: 3, status: 'tentative',  price: 64000,  currency: 'HUF', email: 'szabo.t@gmail.com',       phone: '+36 70 882 0031', comment: 'Még nem fizetett előleget, jövő hétig tartjuk.' },
  { accommodation: 2, arrival: '2026-06-01', departure: '2026-06-05', guestName: 'Tóth Géza',      guests: 2, status: 'confirmed', price: 60000,  currency: 'HUF', email: 'toth.geza@citromail.hu',  phone: '+36 30 441 9920', comment: '' },
  { accommodation: 2, arrival: '2026-06-10', departure: '2026-06-14', guestName: 'Horváth Réka',   guests: 2, status: 'confirmed', price: 52000,  currency: 'HUF', email: 'reka.horvath@gmail.com',  phone: '+36 20 117 6654', comment: '' },
  { accommodation: 2, arrival: '2026-06-20', departure: '2026-06-27', guestName: 'Varga Imre',     guests: 5, status: 'confirmed', price: 91000,  currency: 'HUF', email: 'varga.imre@gmail.com',    phone: '+36 70 309 2218', deposit: 30000, comment: 'Hosszú hétvége, korai érkezés délelőtt.' },
  { accommodation: 3, arrival: '2026-06-06', departure: '2026-06-13', guestName: 'Kiss Mária',     guests: 2, status: 'confirmed', price: 98000,  currency: 'HUF', email: 'kiss.maria@gmail.com',    phone: '+36 30 778 4412', comment: '' },
  { accommodation: 3, arrival: '2026-06-18', departure: '2026-06-22', guestName: 'Németh Pál',     guests: 4, status: 'tentative',  price: 56000,  currency: 'HUF', email: 'nemeth.pal@indamail.hu',  phone: '+36 20 664 1187', deposit: 20000, comment: 'Telefonon érdeklődött, visszahív.' },
  { accommodation: 4, arrival: '2026-06-02', departure: '2026-06-09', guestName: 'Balogh Ottó',    guests: 2, status: 'confirmed', price: 105000, currency: 'HUF', email: 'balogh.otto@gmail.com',   phone: '+36 30 220 5538', comment: '' },
  { accommodation: 4, arrival: '2026-06-15', departure: '2026-06-21', guestName: 'Farkas Júlia',   guests: 3, status: 'confirmed', price: 84000,  currency: 'HUF', email: 'farkas.julia@gmail.com',  phone: '+36 70 991 3302', comment: '' },
  { accommodation: 5, arrival: '2026-06-08', departure: '2026-06-16', guestName: 'Hans Weber',     guests: 2, status: 'confirmed', price: 540,    currency: 'EUR', email: 'h.weber@web.de',          phone: '+49 171 5540022', comment: 'Német vendég, késő érkezés kb. 22:00. Kulcsot a postaládába.', log: [{ timestamp: '2026.04.02 10:14', message: 'Foglalás rögzítve – opciós' }, { timestamp: '2026.04.05 09:30', message: 'Státusz: opciós → megerősített' }, { timestamp: '2026.04.18 16:42', message: 'Ár: 500 € → 540 €' }] },
  { accommodation: 5, arrival: '2026-06-22', departure: '2026-06-30', guestName: 'Lakatos Zsolt',  guests: 4, status: 'confirmed', price: 96000,  currency: 'HUF', email: 'lakatos.zs@gmail.com',    phone: '+36 20 443 7765', comment: '' },
  { accommodation: 6, arrival: '2026-06-05', departure: '2026-06-08', guestName: 'Simon Eszter',   guests: 2, status: 'confirmed', price: 39000,  currency: 'HUF', email: 'simon.eszter@gmail.com',  phone: '+36 30 558 1199', comment: '' },
  { accommodation: 6, arrival: '2026-06-14', departure: '2026-06-20', guestName: 'Fekete Gábor',   guests: 6, status: 'tentative',  price: 78000,  currency: 'HUF', email: 'fekete.g@gmail.com',      phone: '+36 70 226 8843', comment: 'Baráti társaság, megerősítés folyamatban.' },
  { accommodation: 7, arrival: '2026-06-11', departure: '2026-06-18', guestName: 'Anna Müller',    guests: 2, status: 'confirmed', price: 480,    currency: 'EUR', email: 'a.mueller@gmx.de',        phone: '+49 160 7781234', comment: 'Pótágy kérése 1 fő részére.' },
  { accommodation: 7, arrival: '2026-06-21', departure: '2026-06-26', guestName: 'Oláh Krisztina', guests: 3, status: 'confirmed', price: 65000,  currency: 'HUF', email: 'olah.kriszta@gmail.com',  phone: '+36 20 770 4421', comment: '' },
  { accommodation: 8, arrival: '2026-06-04', departure: '2026-06-10', guestName: 'Papp László',    guests: 3, status: 'confirmed', price: 72000,  currency: 'HUF', email: 'papp.laszlo@gmail.com',   phone: '+36 30 113 6677', comment: '' },
  { accommodation: 8, arrival: '2026-06-23', departure: '2026-06-29', guestName: 'Takács Nóra',    guests: 2, status: 'confirmed', price: 70000,  currency: 'HUF', email: 'takacs.nora@gmail.com',   phone: '+36 70 449 1102', comment: '' },
  { accommodation: 0, arrival: '2026-06-07', departure: '2026-06-17', guestName: 'Schmidt család', guests: 8, status: 'confirmed', price: 1400,   currency: 'EUR', email: 'fam.schmidt@web.de',      phone: '+49 172 4456789', comment: 'Egész ház. 2 db gyerekágy, kerékpár tárolás.' },
  { accommodation: 0, arrival: '2026-06-19', departure: '2026-06-26', guestName: 'Rácz Tibor',     guests: 6, status: 'confirmed', price: 156000, currency: 'HUF', email: 'racz.tibor@ceg.hu',       phone: '+36 30 882 5510', comment: 'Céges csapatépítő, számla igény.' },
  { accommodation: 7, arrival: '2026-06-06', departure: '2026-06-07', guestName: 'Kiss Pál',       guests: 2, status: 'confirmed', price: 18000,  currency: 'HUF', email: 'kiss.pal@gmail.com',      phone: '+36 30 555 1234', comment: 'Egy éjszakás foglalás.' },
  { accommodation: 8, arrival: '2026-06-12', departure: '2026-06-16', guestName: 'Tóth Erik',      guests: 3, status: 'confirmed', price: 84000,  currency: 'HUF', email: 'toth.erik@gmail.com',     phone: '+36 20 333 7788', comment: '' },
  { accommodation: 8, arrival: '2026-06-16', departure: '2026-06-20', guestName: 'Nagy Ádám',      guests: 2, status: 'confirmed', price: 72000,  currency: 'HUF', email: 'nagy.adam@gmail.com',     phone: '+36 70 444 9900', comment: 'Érkezés a távozás napján – váltás ugyanazon a napon.' },
  { accommodation: 3, arrival: '2026-06-24', departure: '2026-06-29', guestName: 'Bíró Zoltán',    guests: 2, status: 'confirmed', price: 60000,  currency: 'HUF', email: 'biro.z@gmail.com',        phone: '+36 30 700 1212', comment: 'Vendég lemondta, visszamondás.', deleted: true },
  { accommodation: 6, arrival: '2026-06-01', departure: '2026-06-04', guestName: 'Mészáros Éva',   guests: 3, status: 'tentative',  price: 39000,  currency: 'HUF', email: 'meszaros.eva@gmail.com',  phone: '+36 20 818 4545', comment: 'Opció lejárt, törölve.', deleted: true },
  { accommodation: 1, arrival: '2026-06-28', departure: '2026-07-03', guestName: 'Weber Klára',    guests: 2, status: 'confirmed', price: 75000,  currency: 'HUF', email: 'weber.klara@gmail.com',   phone: '+36 30 661 2200', comment: 'Hónapfordulón átnyúló foglalás.' },
  { accommodation: 4, arrival: '2026-07-05', departure: '2026-07-09', guestName: 'Juhász Ervin',   guests: 4, status: 'tentative',  price: 88000,  currency: 'HUF', email: 'juhasz.e@gmail.com',      phone: '+36 20 552 7788', comment: '' },
  { accommodation: 5, arrival: '2026-05-29', departure: '2026-06-02', guestName: 'Décsi Anna',     guests: 2, status: 'confirmed', price: 54000,  currency: 'HUF', email: 'decsi.anna@gmail.com',    phone: '+36 70 330 1144', comment: 'Előző hónapból átnyúló foglalás.' },
  { accommodation: 2, arrival: '2026-06-30', departure: '2026-07-04', guestName: 'Tóth Sára',      guests: 2, status: 'confirmed', price: 60000,  currency: 'HUF', email: 'toth.sara@gmail.com',     phone: '+36 30 222 8899', comment: 'Hó végi érkezés (30-án), átnyúlik júliusra.' },
  { accommodation: 6, arrival: '2026-05-30', departure: '2026-06-01', guestName: 'Béres Andor',    guests: 3, status: 'confirmed', price: 42000,  currency: 'HUF', email: 'beres.andor@gmail.com',   phone: '+36 20 444 1100', comment: '1-jén távozik (előző hónapból).' },
  { accommodation: 6, arrival: '2026-06-01', departure: '2026-06-03', guestName: 'Véres Andor',    guests: 2, status: 'confirmed', price: 30000,  currency: 'HUF', email: 'veres.andor@gmail.com',   phone: '+36 30 717 2200', comment: 'Béres Andor után, ugyanaznap érkezik (1-jén).' },
]

const seedInsert = db.prepare(`
  INSERT INTO bookings
    (accommodation, guestName, guests, arrival, departure, price, currency,
     deposit, email, phone, comment, status, deleted, createdAt, log)
  VALUES
    (@accommodation, @guestName, @guests, @arrival, @departure, @price, @currency,
     @deposit, @email, @phone, @comment, @status, @deleted, @createdAt, @log)
`)
const seedAll = db.transaction(rows => {
  for (const r of rows) {
    const log = r.log || [{ timestamp: '2026.03.01 09:00', message: 'Foglalás rögzítve – ' + (statusLabel[r.status] || r.status) }]
    seedInsert.run({
      accommodation: r.accommodation,
      guestName: r.guestName,
      guests: r.guests,
      arrival: r.arrival,
      departure: r.departure,
      price: r.price,
      currency: r.currency,
      deposit: r.deposit ?? null,
      email: r.email,
      phone: r.phone,
      comment: r.comment,
      status: r.status,
      deleted: r.deleted ? 1 : 0,
      createdAt: log[0].timestamp,
      log: JSON.stringify(log),
    })
  }
})

if (process.env.SEED_DEMO === '1') {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM bookings').get()
  if (n === 0) {
    seedAll(SEED)
    console.log(`Seed: ${SEED.length} demo-foglalás betöltve.`)
  }
}
