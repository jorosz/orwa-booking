// ============================================================
// E-mail — foglalási kérelem a tulajnak (nodemailer).
//
// Google Workspace SMTP relay-en megy (smtp-relay.gmail.com:587), IP-alapú
// hitelesítéssel — NINCS SMTP-jelszó, NINCS titok a konténerben. A relay az
// orwa-server fix IP-jét (46.101.188.98) engedi, és a Google DKIM-aláírja a
// levelet az orwa.hu nevében (google selector). Így SPF + DKIM aligned → nem
// esik spambe (szemben a korábbi auth-less, aláíratlan aspmx:25 küldéssel).
//
// Workspace admin: Gmail → Routing → SMTP relay service (Only registered Apps
// users in my domains + only-from-IP + require TLS). A `from` ezért valódi
// fiók (orosz@orwa.hu), nem alias.
//
// A törzs a tárolt quote-ból dolgozik (nem a kliensből) → nem hamisítható ár.
// Akár KÉT ajánlat (apartman + vendégház) szerepelhet a quote-ban.
// ============================================================
'use strict'

import nodemailer from 'nodemailer'
import { MAIL_HUF_RATE } from './config.js'

const MAIL_FROM = 'ORWA <orosz@orwa.hu>'
const MAIL_TO = 'ORWA <orosz@orwa.hu>'

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.gmail.com',
  port: 587,
  secure: false,        // STARTTLS a 587-en
  requireTLS: true,     // a relay TLS-t kényszerít — ne menjen titkosítatlanul
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
