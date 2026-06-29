// ============================================================
// Egyszerű, függőség nélküli rate limit a PUBLIKUS végpontokra (pl. /api/quote).
// In-memory fixed-window: IP-nként számoljuk a kéréseket egy `windowMs` hosszú
// ablakban; ha túllépi a `max`-ot → 429 + Retry-After. Nincs külső store (Redis),
// mert egyetlen process fut (lásd SPEC) — egy újraindítás nullázza a számlálókat,
// ami egy irányár-végpontnál teljesen elfogadható.
//
// FONTOS: a kliens IP-hez `app.set('trust proxy', …)` kell (index.js), különben a
// Caddy proxy IP-jét látnánk, és a limit globális lenne IP-nkénti helyett.
// ============================================================
'use strict'

const ts = () => new Date().toISOString()

// Egy ablak állapota IP-nként: { count, resetAt }. A régi (lejárt) bejegyzéseket
// egy ritka söprés takarítja, hogy a Map ne hízzon korlátlanul.
export function rateLimit({ windowMs = 60_000, max = 10 } = {}) {
  const hits = new Map()

  // Lejárt bejegyzések takarítása ablakonként egyszer (unref → nem tartja életben
  // a processt, pl. teszteknél).
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [ip, e] of hits) if (e.resetAt <= now) hits.delete(ip)
  }, windowMs)
  if (sweep.unref) sweep.unref()

  return function rateLimiter(req, res, next) {
    const now = Date.now()
    const ip = req.ip || 'unknown'
    let e = hits.get(ip)
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + windowMs }
      hits.set(ip, e)
    }
    e.count++

    if (e.count > max) {
      const retryAfter = Math.ceil((e.resetAt - now) / 1000)
      res.set('Retry-After', String(retryAfter))
      console.log(`${ts()}  RATE-LIMIT ${req.method} ${req.originalUrl} ip=${ip} (${e.count}/${max})`)
      return res.status(429).json({ error: 'rate_limited', retryAfter })
    }
    next()
  }
}
