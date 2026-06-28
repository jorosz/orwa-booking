// ============================================================
// Árazás — irányár EUR/éj tartományban, akár KÉT ajánlattal (apartman + vendégház).
// A helyi pénznemre váltás a frontenden történik (rate-tel), itt minden EUR.
//
// Szabályok (lásd SPEC.md §Árazás):
//   • Apartman (max 4 fő/egység):  2 fő 55–60 · 3 fő 60–65 · 4 fő 65–70 €/éj
//   • Vendégház (2–8 fő):          min = 120 + 5·(fő−2),  max = 130 + 5·(fő−2)
//   • Ajánlatok ≤8 főig: apartman ÉS vendégház egyszerre. Sorrend: ≤3 fő →
//     apartman elöl; 4–8 fő → vendégház elöl + 2 apartman (ár szorzódik).
//   • >8 fő: csak apartman, qty = ceil(fő/4), fix 60 €/éj (a mostani kerekítés).
//   • Felár a tartomány MINDKÉT végére: 1 éj +20%, 2 éj +10%.
//
// CSAK ELÉRHETŐ AJÁNLAT JÖHET: az ajánlat vagy szabad a naptárban, vagy meg sem
// jelenik (nincs per-ajánlat `available` flag). Vendégház csak ha guestHouseFree;
// apartman csak ha van elég szabad egység. Ha egy sincs → üres lista (a hívó a
// top-level `available`-lel jelzi a „nincs szabad” esetet).
// ============================================================
'use strict'

const SURCHARGE = { 1: 1.20, 2: 1.10 } // éjszakaszám → szorzó (egyébként 1)

// Apartman egységár (1 egység, adott létszámra), 2–4 fő közé szorítva.
function apartmentRate(guests) {
  const g = Math.min(Math.max(guests, 2), 4)
  if (g <= 2) return { min: 55, max: 60 }
  if (g === 3) return { min: 60, max: 65 }
  return { min: 65, max: 70 } // 4 fő
}

// Vendégház ár (egész ház), 2–8 fő.
function houseRate(guests) {
  const g = Math.min(Math.max(guests, 2), 8)
  return { min: 120 + 5 * (g - 2), max: 130 + 5 * (g - 2) }
}

// Felár a per-éj tartományra, kerekítve egész euróra.
function withSurcharge(rate, nights) {
  const m = SURCHARGE[nights] || 1
  return { min: Math.round(rate.min * m), max: Math.round(rate.max * m) }
}

// Egy ajánlat objektum. A perNight* per EGYSÉG; a total* a qty-t és az
// éjszakákat is beszámítja. (Minden visszaadott ajánlat eleve elérhető.)
function makeOffer(type, qty, perNight, nights) {
  return {
    type,
    qty,
    perNightMin: perNight.min,
    perNightMax: perNight.max,
    totalMin: perNight.min * nights * qty,
    totalMax: perNight.max * nights * qty,
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
    const per = withSurcharge({ min: 60, max: 60 }, nights)
    return [makeOffer('apartman', qty, per, nights)]
  }

  // Apartman ajánlat: ≤3 fő → 1 egység; 4–8 fő → 2 egység (létszám fele/egység).
  // Csak ha van elég szabad egység.
  const aptQty = guests <= 3 ? 1 : 2
  const aptGuestsPerUnit = guests <= 3 ? guests : Math.ceil(guests / 2)
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
