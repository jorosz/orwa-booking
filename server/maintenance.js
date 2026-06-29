// ============================================================
// Napi karbantartás — hajnali 1-kor (Europe/Budapest), a meglévő Node-processzen
// belül (in-process, nem sidecar). Sorrend: BACKUP → PURGE → ANONIMIZÁLÁS
// (előbb mentsünk, csak utána töröljünk). Részletek + indoklás: BACKUP.md.
//
// Env:
//   BACKUP_BUCKET  S3 bucket a mentésekhez (ha nincs, a backup-lépés kimarad)
//   AWS_REGION     a bucket régiója                  (default: "eu-central-1")
// A backup-bucket creds-et az SDK a futtató IAM task-role-ból veszi (nincs titok).
// ============================================================
'use strict'

import { gzipSync } from 'node:zlib'
import { readFileSync, rmSync } from 'node:fs'
import { Cron } from 'croner'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

import { snapshotTo, purgeExpiredDeletedBookings } from './db.js'
import { anonymizeOldQuotes } from './quotes.js'

const ts = () => new Date().toISOString()

// ── 1) Backup: VACUUM INTO snapshot → gzip → S3 ──────────────────────────────
export async function backup() {
  const bucket = process.env.BACKUP_BUCKET
  if (!bucket) {
    console.log(`${ts()}  MAINT backup skipped (no BACKUP_BUCKET)`)
    return
  }
  const day = new Date().toISOString().slice(0, 10)   // YYYY-MM-DD
  const tmp = `/tmp/orwa-${day}.db`
  rmSync(tmp, { force: true })                         // VACUUM INTO célfájl nem létezhet
  try {
    snapshotTo(tmp)
    const body = gzipSync(readFileSync(tmp))
    const s3 = new S3Client({ region: process.env.AWS_REGION || 'eu-central-1' })
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `orwa-${day}.db.gz`, Body: body }))
    console.log(`${ts()}  MAINT backup ok → s3://${bucket}/orwa-${day}.db.gz (${body.length} B gz)`)
  } finally {
    rmSync(tmp, { force: true })
  }
}

// ── A teljes napi futás (egyenként hibatűrő, hogy egy hiba ne vigye a többit) ─
export async function runMaintenance() {
  try { await backup() } catch (e) { console.error(`${ts()}  MAINT backup FAIL`, e && e.stack ? e.stack : e) }
  try {
    const n = purgeExpiredDeletedBookings()
    console.log(`${ts()}  MAINT purge ok (${n} törölt+lejárt foglalás véglegesen törölve)`)
  } catch (e) { console.error(`${ts()}  MAINT purge FAIL`, e && e.stack ? e.stack : e) }
  try {
    const n = anonymizeOldQuotes()
    console.log(`${ts()}  MAINT anonymize ok (${n} quote_requests PII anonimizálva)`)
  } catch (e) { console.error(`${ts()}  MAINT anonymize FAIL`, e && e.stack ? e.stack : e) }
}

// ── Ütemezés: minden nap 01:00, helyi (budapesti) idő ────────────────────────
// A croner a timezone-t ICU-n keresztül kezeli, így a DST helyes, és nem függ a
// konténer rendszer-TZ-jétől / tzdata-tól.
export function startMaintenance() {
  const job = new Cron('0 1 * * *', { timezone: 'Europe/Budapest' }, runMaintenance)
  console.log(`${ts()}  MAINT scheduled daily 01:00 Europe/Budapest; next: ${job.nextRun()?.toISOString()}`)
  return job
}
