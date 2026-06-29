// ============================================================
// Központi konfiguráció — minden hangolható szám EGY helyen.
//   • LIMITS  — quote/book validációs korlátok (validate.js használja)
//   • PRICING — irányárazás (pricing.js használja; a logika ott marad)
// A részletes árazási szabályok magyarázata a pricing.js fejlécében / SPEC.md-ben.
// ============================================================
'use strict'

// ── Validációs korlátok (validate.js) ────────────────────────────────────────
export const LIMITS = {
  minAdvanceDays: 3,
  maxAdvanceDays: 365,
  minNights: 1,
  maxNights: 21,
  maxGuests: 12,
}

// ── Árak (EUR/éj) — a logika pricing.js-ben, itt csak a hangolható számok ─────
export const PRICING = {
  // Apartman egységár (1 egység), a benne lakó létszám szerint. Spread 10.
  apartmentRate: {
    2: { min: 55, max: 65 },
    3: { min: 60, max: 70 },
    4: { min: 65, max: 75 },
  },
  // Nagy csoport (>8 fő): minden apartman fix bulk-áron, létszámtól függetlenül.
  apartmentBulkRate: { min: 60, max: 70 },
  // Vendégház (egész ház): 2 fős bázis + főnkénti lépés (2 fő felett). Spread 15.
  houseBase: { min: 120, max: 135 }, // 2 főre
  houseStepPerGuest: 5,              // minden további fő (2 felett) ennyivel emel
  // Éjszakaszám-felár: szorzó éjszakaszám szerint (a többi → 1).
  surcharge: { 1: 1.20, 2: 1.10 },
}

// ── E-mail pénznem ────────────────────────────────────────────────────────────
// A tulajnak menő levélben magyar nyelvnél (lang === 'hu') Ft-ban írjuk az árat,
// EUR × ennyi árfolyammal. Más nyelvnél EUR marad.
export const MAIL_HUF_RATE = 400
