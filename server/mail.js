// ============================================================
// E-mail — foglalási kérelem a tulajnak (SMTP, Gmail, nodemailer).
// A törzs a tárolt quote-ból dolgozik (nem a kliensből) → nem hamisítható ár.
// Mostantól AKÁR KÉT ajánlat (apartman + vendégház) szerepelhet a quote-ban.
// ============================================================
'use strict'

import nodemailer from 'nodemailer'

const SMTP = { host: 'smtp.gmail.com', port: 587, user: 'admin@orwa.hu', pass: process.env.GMAIL_APP_PASSWORD || '' }
const MAIL_FROM = 'ORWA Admin <admin@orwa.hu>'
const MAIL_TO = 'ORWA <orosz@orwa.hu>'

const transporter = nodemailer.createTransport({
  host: SMTP.host,
  port: SMTP.port,
  secure: SMTP.port === 465,
  auth: SMTP.user ? { user: SMTP.user, pass: SMTP.pass } : undefined,
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
    `Létszám:  ${q.guests}`,
    '',
    'Irányár-ajánlat(ok):',
    offers,
    q.available === false ? '\n[!] A kért időpontra a naptár szerint NINCS szabad szállás.' : '',
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
