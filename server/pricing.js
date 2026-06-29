// ============================================================
// Árazás — irányár EUR/éj tartományban, akár KÉT ajánlattal (apartman + vendégház).
// A helyi pénznemre váltás a frontenden történik (rate-tel), itt minden EUR.
//
// Szabályok (lásd SPEC.md §Árazás):
//   • Apartman (max 4 fő/egység):  2 fő 55–65 · 3 fő 60–70 · 4 fő 65–75 €/éj (spread 10)
//   • Vendégház (2–8 fő):          min = 120 + 5·(fő−2),  max = 135 + 5·(fő−2)  (spread 15)
//   • Ajánlatok ≤8 főig: apartman ÉS vendégház egyszerre. Sorrend: ≤3 fő →
//     apartman elöl; 4–8 fő → vendégház elöl, 5 főtől 2 apartman
//   • >8 fő: csak apartman, qty = ceil(fő/4), 60–70 €/éj (spread 10).
//   • Felár a tartomány MINDKÉT végére: 1 éj +20%, 2 éj +10%.
//
// CSAK ELÉRHETŐ AJÁNLAT JÖHET: az ajánlat vagy szabad a naptárban, vagy meg sem
// jelenik (nincs per-ajánlat `available` flag). Vendégház csak ha guestHouseFree;
// apartman csak ha van elég szabad egység. Ha egy sincs → üres lista (a hívó a
// top-level `available`-lel jelzi a „nincs szabad” esetet).
// ============================================================
'use strict'

// ── Árak (EUR/éj). Minden hangolható szám EGY helyen — a logika lentebb. ──────
const CONFIG = {
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

// Apartman egységár adott létszámra, 2–4 fő közé szorítva.
function apartmentRate(guests) {
  const g = Math.min(Math.max(guests, 2), 4)
  return CONFIG.apartmentRate[g]
}

// Vendégház ár (egész ház), 2–8 fő.
function houseRate(guests) {
  const g = Math.min(Math.max(guests, 2), 8)
  const step = CONFIG.houseStepPerGuest * (g - 2)
  return { min: CONFIG.houseBase.min + step, max: CONFIG.houseBase.max + step }
}

// Felár a per-éj tartományra, kerekítve egész euróra.
function withSurcharge(rate, nights) {
  const m = CONFIG.surcharge[nights] || 1
  return { min: Math.round(rate.min * m), max: Math.round(rate.max * m) }
}

// Egy ajánlat objektum. A `perNight` paraméter per EGYSÉG jön be, de a kimeneti
// perNight*/total* az EGÉSZ ajánlatra szól (qty-vel szorozva) — így 2 apartmannál
// a per-éj range (és a spreadje) is duplázódik. total* még az éjszakákat is
// beszámítja. (Minden visszaadott ajánlat eleve elérhető.)
function makeOffer(type, qty, perNight, nights) {
  return {
    type,
    qty,
    perNightMin: perNight.min * qty,
    perNightMax: perNight.max * qty,
    totalMin: perNight.min * qty * nights,
    totalMax: perNight.max * qty * nights,
  }
}

// avail = { apartmentsFree: number (0–8), guestHouseFree: boolean }
// Visszaad: a javaslati sorrendben az ELÉRHETŐ ajánlatok (0–2 elem). Üres lista
// = a kért időpontra nincs szabad szállás.
export function priceOffers(nights, guests, avail) {
  // >8 fő: csak apartman, kerekítés — nem bonyolítjuk (vendégház max 8 fő).
  if (guests > 8) {
    const qty = Math.ceil(guests / 4)
    if (avail.apartmentsFree < qty) return []
    const per = withSurcharge(CONFIG.apartmentBulkRate, nights)
    return [makeOffer('apartman', qty, per, nights)]
  }

  // Apartman ajánlat: ≤4 fő → 1 egység; 5–8 fő → 2 egység (létszám fele/egység).
  // Csak ha van elég szabad egység.
  const aptQty = guests <= 4 ? 1 : 2
  const aptGuestsPerUnit = guests <= 4 ? guests : Math.ceil(guests / 2)
  const aptOffer = avail.apartmentsFree >= aptQty
    ? makeOffer('apartman', aptQty, withSurcharge(apartmentRate(aptGuestsPerUnit), nights), nights)
    : null

  // Vendégház ajánlat — csak ha a naptárban szabad.
  const houseOffer = avail.guestHouseFree
    ? makeOffer('house', 1, withSurcharge(houseRate(guests), nights), nights)
    : null

  // Sorrend: ≤3 fő → apartman elöl; 4–8 fő → vendégház elöl.
  const offers = []
  if (guests <= 3) {
    if (aptOffer) offers.push(aptOffer)
    if (houseOffer) offers.push(houseOffer)
  } else {
    if (houseOffer) offers.push(houseOffer)
    if (aptOffer) offers.push(aptOffer)
  }
  return offers
}
