// ============================================================
// E-mail — foglalási kérelem a tulajnak (nodemailer).
//
// AUTH NÉLKÜLI küldés, ahogy az orwaweb (public/api/book.php): közvetlenül az
// orwa.hu MX-ére (aspmx.l.google.com:25) — NINCS SMTP-jelszó, NINCS titok. Az
// aspmx jelszó nélkül fogadja az orwa.hu-ra címzett levelet (ez a domain MX-e).
// STARTTLS opportunisztikus; a cert-nevet nem kényszerítjük (deliverability >
// szigorú TLS-verifikáció ehhez a belső, inbound-MX küldéshez).
//
// A törzs a tárolt quote-ból dolgozik (nem a kliensből) → nem hamisítható ár.
// Akár KÉT ajánlat (apartman + vendégház) szerepelhet a quote-ban.
// ============================================================
'use strict'

import nodemailer from 'nodemailer'
import { MAIL_HUF_RATE } from './config.js'

const MAIL_FROM = 'ORWA Admin <admin@orwa.hu>'
const MAIL_TO = 'ORWA <orosz@orwa.hu>'

const transporter = nodemailer.createTransport({
  host: 'aspmx.l.google.com',
  port: 25,
  secure: false,                       // STARTTLS opportunisztikusan, ha támogatott
  tls: { rejectUnauthorized: false },  // ne bukjon cert-név-eltérésen (mint az orwaweb)
})

const typeLabel = { apartman: 'apartman', house: 'vendégház' }

// Magyar nyelvnél Ft-ban írjuk (EUR × MAIL_HUF_RATE), egyébként EUR-ban.
function money(lang, eur) {
  return lang === 'hu' ? { v: eur * MAIL_HUF_RATE, unit: 'Ft' } : { v: eur, unit: 'EUR' }
}

function offerLine(o, lang) {
  const what = `${o.qty} × ${typeLabel[o.type] || o.type}`
  const pnMin = money(lang, o.perNightMin), pnMax = money(lang, o.perNightMax)
  const tMin = money(lang, o.totalMin), tMax = money(lang, o.totalMax)
  const perNight = `${pnMin.v}–${pnMax.v} ${pnMin.unit}/éj/szállás`
  const total = `${tMin.v}–${tMax.v} ${tMin.unit}`
  return `  • ${what}: ${total}  (${perNight})`
}

function bookingEmailText(q, b, lang) {
  const offerList = q.quote || []
  const offers = offerList.map((o) => offerLine(o, lang)).join('\n') || '  (nincs ajánlat)'
  const lines = [
    'Foglalási kérelem (orwa.hu)',
    '',
    `Nyelv:    ${lang}`,
    `Név:      ${b.name}`,
    `E-mail:   ${b.email}`,
    `Telefon:  ${b.phone}`,
    '',
    `Érkezés:  ${q.checkin}`,
    `Távozás:  ${q.checkout}`,
    `Éjszakák: ${q.nights}`,
    `Létszám:  ${q.guests} fő`,
    '',
    'Irányár-ajánlat(ok):',
    offers,
  ]

  // A vendég által (opcionálisan) megjelölt ajánlat — érvénytelen/hiányzó index → kihagyjuk.
  const prefOffer = Number.isInteger(b.preferred) ? offerList[b.preferred] : undefined
  if (prefOffer) {
    lines.push('', `Megjelölt szállás: ${prefOffer.qty} × ${typeLabel[prefOffer.type] || prefOffer.type}`)
  }
  // Egyéb megjegyzés / különleges kérés (szabad szöveg).
  if (b.note) {
    lines.push('', 'Megjegyzés / különleges kérés:', b.note)
  }

  return lines.join('\n')
}

export function sendBookingMail(q, b, lang) {
  return transporter.sendMail({
    from: MAIL_FROM,
    to: MAIL_TO,
    replyTo: { name: b.name, address: b.email },
    subject: `Foglalási kérelem – ${b.name}`,
    text: bookingEmailText(q, b, lang),
  })
}
