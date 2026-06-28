# orwa-booking

ORWA **egyesített booking backend**: a weboldal irányár-becslése (`/api/quote`,
`/api/book`) és a naptár valódi foglalásai (`/api/bookings*`) egy Node
(Express + better-sqlite3) service-ben. **Csak a belső Docker-hálón** fut,
publikált port nélkül; a két frontend (orwa-new, orwa-naptar) a saját Caddy
proxy-rétegén keresztül éri el.

## Dokumentáció

- **[SPEC.md](SPEC.md)** — architektúra, biztonsági (path-szintű jogosultság)
  határ, árazás, végpontok, adatmodell, frontend-TODO-k.

## Gyors start

```sh
nvm use            # Node 24 (.nvmrc)
npm install
npm run dev        # demo-adatokkal (SEED_DEMO=1), :8000
```

```sh
curl localhost:8000/healthz
curl -X POST localhost:8000/api/quote -H 'Content-Type: application/json' \
  -d '{"checkin":"2026-09-10","checkout":"2026-09-14","guests":5}'
```

## Struktúra

```
server/
  index.js     # Express: publikus (quote/book) + admin (bookings) route-ok
  pricing.js   # kétajánlatos árazás (apartman + vendégház), felárak
  db.js        # SQLite: bookings tábla, CRUD, ütközés, elérhetőség (in-process)
  validate.js  # quote/book validáció (err-kódok = kliens i18n)
  quotes.js    # quote-tár + érdeklődési napló egyben (quote_requests tábla, orwa.db)
  mail.js      # nodemailer — foglalási kérelem e-mail
Dockerfile     # node:24-slim, better-sqlite3 natív build
```

## Deploy

ECR image: `orwa-booking` (prod) · `orwa-booking-pp` (preprod). Belső service,
`/data` perzisztens volume (`orwa.db`). A live stacket az
`../orwa-server` compose vezényli; a domain/TLS/auth az `../orwa-edge` és a két
frontend Caddyja. Részletek a deploy-réteg összekötésekor kerülnek ide.
