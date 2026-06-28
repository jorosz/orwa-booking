// ============================================================
// Quote-tár + naplózás.
//   • In-memory Map: a kiadott irányárak (id → teljes válasz). A /api/book ebből
//     veszi az árat, hogy a kliens ne tudjon hamisítani. Container-lifetime —
//     az érdeklődési flow percek alatt lezajlik, nincs DB.
//   • NDJSON append-only log (/data/quotes.log) minden quote/book eseményről.
// ============================================================
'use strict'

import fs from 'node:fs'
import path from 'node:path'

const LOG_FILE = process.env.QUOTES_LOG
  || path.join(path.dirname(process.env.DB_PATH || '/data/orwa.db'), 'quotes.log')

const quotes = new Map()

export function saveQuote(result) {
  quotes.set(result.id, result)
}
export function getQuote(id) {
  return quotes.get(id)
}

export function appendLog(obj) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n'
  fs.appendFile(LOG_FILE, line, () => {}) // tűz és felejtsd — a server nem vár rá
}
