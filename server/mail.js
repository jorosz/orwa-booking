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

const MAIL_FROM = 'ORWA Admin <admin@orwa.hu>'
const MAIL_TO = 'ORWA <orosz@orwa.hu>'

const transporter = nodemailer.createTransport({
  host: 'aspmx.l.google.com',
  port: 25,
  secure: false,                       // STARTTLS opportunisztikusan, ha támogatott
  tls: { rejectUnauthorized: false },  // ne bukjon cert-név-eltérésen (mint az orwaweb)
})

const typeLabel = { apartman: 'apartman', house: 'vendégház' }

function offerLine(o) {
  const what = `${o.qty} × ${typeLabel[o.type] || o.type}`
  const perNight = `${o.perNightMin}–${o.perNightMax} EUR/éj`
  const total = `${o.totalMin}–${o.totalMax} EUR`
  return `  • ${what}: ${total}  (${perNight})`
}

function bookingEmailText(q, b, lang) {
  const offers = (q.quote || []).map(offerLine).join('\n') || '  (nincs ajánlat)'
  return [
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
  ].join('\n')
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
