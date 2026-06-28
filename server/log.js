// ============================================================
// Operatív log a stdout/stderr-re — hogy egy buta `docker logs`-ból is ki
// lehessen nyerni az alapinformációt: ki hívta melyik végpontot, mi lett a
// státusz, és HIBA esetén a teljes error (stacktrace). Ez NEM az üzleti napló
// (az a quote_requests táblába megy, lásd quotes.js) — ez a futási diagnosztika.
//
// Formátum: egysoros, greppelhető. Minden kérésről egy sor a válasz lezárásakor:
//   2026-06-28T14:32:10.123Z  POST /api/quote → 200 (12ms)
//   2026-06-28T14:32:45.456Z  POST /api/book → 500 (842ms)
// 5xx a stderr-re megy (console.error), minden más a stdout-ra.
// ============================================================
'use strict'

const ts = () => new Date().toISOString()

// ── Kérés-log middleware (a route-ok ELŐTT app.use-olva) ─────────────────────
export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint()
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    const line = `${ts()}  ${req.method} ${req.originalUrl} → ${res.statusCode} (${ms.toFixed(0)}ms)`
    if (res.statusCode >= 500) console.error(line)
    else console.log(line)
  })
  next()
}

// ── Hiba-middleware (a route-ok UTÁN, utolsóként app.use-olva) ────────────────
// A teljes errort (stacktrace) a stderr-re, és 500-as választ ad. Ide jut minden
// el nem kapott throw a sync handlerekből, ill. amit egy async handler next(e)-vel
// továbbad (Express 4 az async throw-t magától nem kapja el — lásd index.js).
export function errorLogger(err, req, res, next) {
  console.error(`${ts()}  ERROR ${req.method} ${req.originalUrl} →`, err && err.stack ? err.stack : err)
  if (res.headersSent) return next(err)
  res.status(500).json({ error: 'internal' })
}

// ── Crash-log: a process-szintű, el nem kapott hibák is látszódjanak ─────────
export function installCrashLogging() {
  process.on('unhandledRejection', (reason) => {
    console.error(`${ts()}  UNHANDLED REJECTION`, reason && reason.stack ? reason.stack : reason)
  })
  process.on('uncaughtException', (err) => {
    console.error(`${ts()}  UNCAUGHT EXCEPTION`, err && err.stack ? err.stack : err)
  })
}
