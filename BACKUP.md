# orwa-booking — mentés & archiválás

A `orwa.db` (SQLite) mentése S3-ra, és a személyes adatok (PII) **visszaállíthatatlan**
törlése egy idő után — úgy, hogy a mentésekben se ragadjanak benne. Architektúra:
[SPEC.md](SPEC.md), üzemeltetés: [DEPLOY.md](DEPLOY.md).

## Az alapelv

> Hard-törlés az élő DB-ből + **30 napos** gördülő S3-mentés ⇒ a törölt adat
> legkésőbb **+30 napra** eltűnik mindenhonnan, amit a rendszer kontrollál.

Ezért **nem szabad** 30 napnál hosszabb retenciójú mentés vagy bármilyen
immutability sehol — különben a fenti garancia megbukik.

## 1. Mentés: `orwa.db` → S3 (napi)

A WAL miatt nem `cp`-vel mentünk, hanem konzisztens snapshotot készítünk. A
`VACUUM INTO` egyúttal kihagyja a szabad lapokat, így a snapshotban **nincs**
törölt-adat maradék. 

**S3 bucket beállítások:**

| Beállítás | Érték | Miért |
|---|---|---|
| Lifecycle expiry | **30 nap** | ez a tényleges garancia a törlésre |
| Versioning | **KI** | régi verziók túlélnék a törlést |
| Object Lock | **SOHA** | lock alatt nem lehetne törölni → megbukna a 30 nap |
| Block Public Access | ON | — |
| Titkosítás | SSE-S3 (vagy KMS) | — |

A bucketben csak a mentések vannak, nincs kulcs-prefix.

**IAM (statikus user-kulcs, nem role):** a futtató host nem AWS (DigitalOcean
droplet, később más — de nem AWS), így nincs IAM task/instance-role. Ezért egy
dedikált **IAM user** van, **least-privilege: csak `s3:PutObject`** erre az egy
bucketre (se list, se get, se delete). Ha a kulcs kiszivárog, meglévő mentést **se
olvasni, se törölni** nem tud — csak feltölteni. Visszaállítás külön, manuális
hozzáféréssel.

**A kulcs helye:** a két titok — `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
— jön a hoston a gitignore-olt `.env`-ből (compose `${...}` interpoláció); a
`BACKUP_BUCKET` és `AWS_REGION` nem titok, azok a compose-ban fixek.

(Lokális teszthez — ahol nincs compose — a `BACKUP_BUCKET`/`AWS_REGION` is kell az
`.env`-ben, lásd a repó `.env.example`-jét; a kód onnan olvassa.)

> ⚠️ **Preprod: NE kapjon backup-konfigot.** A preprod (`orwa-booking-pp`) env-jébe
> **ne** kerüljön `BACKUP_BUCKET` (és AWS-kulcs) → a backup-lépés kimarad

**Visszaállítás** (manuálisan, ritkán):

```sh
aws s3 cp s3://orwa-booking-backup/orwa-2026-06-29.db.gz .
gunzip orwa-2026-06-29.db.gz
# a service leállítva → cseréld a /data/orwa.db-t (a -wal/-shm törölhető)
```

## 2. Törölt foglalások végleges törlése (napi)

A `deleted=1` csak soft-delete. A purge-job a `departure` után **ténylegesen**
törli a sort. A `secure_delete` gondoskodik róla, hogy a byte-ok nullázódjanak az
élő fájlban is (különben forenzikusan visszafejthető marad).

Korlát: ami a tegnapi mentésben benne van, az még **max 30 napig** él az S3-ban — ennél gyorsabban a mentésből nem tűnik el.

## 3. quote_requests — PII anonimizálás 3 hónap után (napi)

A `quote_requests` minden érdeklődőről tárol PII-t (`name`, `email`, `phone`,
`ip`). Erre csak rövid távon van szükség: ha egy foglalási e-mail beragad
(`mailStatus='failed'`), legyen mihez nyúlni. **3 hónap** után ez megszűnik →
a sort nem töröljük (statisztikának jó), csak a PII-t anonimizáljuk **helyben**:

- `name` → egyszerű hash (visszakereshető legyen egy panasznál, de ne legyen olvasható)
- `email`, `phone`, `ip` → törölve (`NULL`)

(`secure_delete=ON` mellett az UPDATE-tel felszabaduló régi byte-ok is
nullázódnak; a `VACUUM INTO`-s mentés pedig eleve nem viszi a szabad lapokat.)

## 4. Ütemezés

Mindhárom job napi egyszer, **hajnali 1-kor**, a meglévő Node-processzen belül
(in-process, nem sidecar). A `server/maintenance.js` a `croner` cron-libbel
ütemezi, és ebben a sorrendben futtat: **backup → bookings-purge →
quote-anonimizálás** (előbb mentsünk, aztán töröljünk). A SQL a `db.js` /
`quotes.js` connection-jén megy (`secure_delete` pragma).

**Időzóna:** a `croner` a `timezone: 'Europe/Budapest'` opcióval ICU-n át kezeli
az időt (DST-helyes).

## 5. Amit ez NEM fed le

- **E-mail postafiók** (`orosz@orwa.hu`): a kiküldött foglalási levelek ott
  maradnak, a rendszer nem törli. Külön, kézi szokás.
- **Kézi mentés-másolat** (letöltött `.db`, fejlesztői gép): megöli a 30 napos
  garanciát. Egyetlen bucket, kötelező lifecycle, máshol nincs másolat.

## 6. AWS-setup (egyszeri, kézzel)

A fiók: `197795502251`, régió `eu-central-1`. Bucket: `orwa-booking-backup`
Két IAM-szereplő:

- **operátor-user** = a *te* AWS-userod, amivel a **bucket** setupot futtatod
- **technikai user** (`orwa-booking-backup`) = amit a service használ, **csak**
  feltöltésre — ezt **root-ként, a konzolon** gyártod

### 6.1 Bucket létrehozás

A a **saját, konzolos usereddel** futtatod. Ha ennek nincs még S3-joga, told rá a konzolon a gyári **`AmazonS3FullAccess`** policy-t.

```sh
BUCKET=orwa-booking-backup
REGION=eu-central-1

# 1) Bucket (eu-central-1 → kell a LocationConstraint)
aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"

# 2) Public access TELJES tiltása
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 3) Titkosítás (SSE-S3 / AES256 — ma alapból ez, csak explicit)
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# 4) Lifecycle: 30 nap után minden objektum lejár (EZ a törlési garancia)
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration \
  '{"Rules":[{"ID":"expire-30d","Status":"Enabled","Filter":{},"Expiration":{"Days":30}}]}'

# 5) Versioning: NEM kapcsoljuk be (alapból ki). Object Lock: SEMMIKÉPP.
```

### 6.2 Technikai user + `s3:PutObject` policy (root-ként, a webes konzolon)

IAM-jogot senki CLI-userére nem teszünk → ezt a webes konzolon csinálod, **root**
(vagy IAM-jogú konzol-user) alatt. Lépések (IAM → Users):

1. **Create user** → név `orwa-booking-backup`, **konzolos belépés NÉLKÜL**
   (csak programozott hozzáférés).
2. A usernél **Add permissions → Create inline policy → JSON**, név `s3-put-only`,
   tartalom (least-privilege: csak feltöltés erre az egy bucketre):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::orwa-booking-backup/*" }
     ]
   }
   ```

3. **Security credentials → Create access key** (use case: *Application running
   outside AWS* / third-party). A **Secret access key CSAK most látszik egyszer** —
   mentsd azonnal.

A kapott `AccessKeyId` + `SecretAccessKey` → a droplet gitignore-olt `.env`-jébe
(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).