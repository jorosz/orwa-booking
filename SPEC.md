# ORWA Booking — egyesített backend · Specifikáció

A korábbi **két** backend egy service-be vonva:

- az **orwa-new** weboldal `api/` sidecarja (irányár-becslés + foglalási kérelem
  e-mailben), és
- az **orwa-naptar** Express/SQLite backendje (a valódi foglalások CRUD-ja).

Egy Node (Express + better-sqlite3) service, **csak a belső Docker-hálón** látható,
publikált port nélkül. A két frontend (weboldal, naptár) a saját **proxy-rétegén**
(Caddy) keresztül éri el, path szerint szétválasztva.

---

## 1. Architektúra

```
            ┌──── orwa-edge (80/443, TLS, routing, fail2ban) ────┐
 orwa.hu/.de/.com → orwa (content-Caddy):80                       │
 naptar.orwa.hu   → orwa-naptar (Caddy, basic_auth):80            │
            └────────┬───────────────────────────┬────────────────┘
       ┌─────────────▼────────┐      ┌────────────▼───────────────┐
       │ orwa (content-Caddy) │      │ orwa-naptar (statikus+Caddy)│
       │  /      → Hugo       │      │  /      → React dist        │
       │  /api/quote,/api/book│      │  /api/bookings* ─┐          │
       │        → booking ────┼──┐   │        → booking ┼─proxy    │
       └──────────────────────┘  │   └──────────────────┼──────────┘
                                  ▼                      ▼
                      ┌─────────────────────────────────────┐
                      │ orwa-booking (ez a repó, :8000)      │
                      │  POST /api/quote · /api/book         │
                      │  GET/POST /api/bookings*             │
                      │  SQLite orwa.db + quotes.log (/data) │
                      │  SMTP → Gmail (GMAIL_APP_PASSWORD)   │
                      └─────────────────────────────────────┘
```

A **foglaltság-ellenőrzés in-process** DB-query (eltűnt a korábbi konténerek
közötti `NAPTAR_URL` HTTP-hop). Apartman (1–8) és vendégház (0) elérhetősége
külön számolódik.

---

## 2. Biztonság — path-szintű jogosultság (FONTOS)

A service maga **auth-mentes** (mint a naptár volt); a beléptetés a proxyban van.
Egy porton kétféle jogosultságú útvonal fut, ezért a proxy-rétegnek **path szerint
szét kell választania**:

| Útvonal | Jelleg | Ki proxyzhatja |
|---|---|---|
| `POST /api/quote`, `POST /api/book`, `GET /healthz` | **publikus** | orwa-new content-Caddy (auth nélkül) |
| `GET/POST /api/bookings`, `/api/bookings/:id`, `…/delete` | **privilegizált** | orwa-naptar Caddy (basic_auth mögött) |

> ⚠️ A **content-Caddy SOHA** nem proxyzhatja a `/api/bookings*`-ot — különben a
> publikus weboldalról elérhetővé válna a foglalás-CRUD. A content-Caddyban a
> korábbi `handle /api/*` helyett **csak** `/api/quote` és `/api/book` (+`/healthz`)
> engedélyezett.

---

## 3. Konfiguráció

| Env | Leírás | Default |
|---|---|---|
| `GMAIL_APP_PASSWORD` | Gmail app-jelszó (az egyetlen titok) | `""` (SMTP nem küld) |
| `DB_PATH` | a SQLite DB helye | `/data/orwa.db` (lokál: `server/orwa.db`) |
| `PORT` | a service portja | `8000` |
| `SEED_DEMO` | `1` esetén 31 demo-foglalás üres táblába (dev) | nincs (üres DB) |
| `QUOTES_LOG` | a quote-napló helye | `<DB_PATH mappa>/quotes.log` |

Korlátok (kódban fixek, `server/validate.js`): `minAdvanceDays 0`,
`maxAdvanceDays 365`, `minNights 1`, `maxNights 30`, `maxGuests 12`.

---

## 4. Árazás (`server/pricing.js`)

Minden EUR/éj, **tartomány** (min–max); a helyi pénznemre váltás a frontenden.

- **Apartman** (max 4 fő/egység): 2 fő `55–60` · 3 fő `60–65` · 4 fő `65–70`.
- **Vendégház** (2–8 fő): `min = 120 + 5·(fő−2)`, `max = 130 + 5·(fő−2)`.
- **Ajánlatok ≤8 főig: apartman ÉS vendégház egyszerre.** Sorrend (javaslat):
  - ≤3 fő → **apartman elöl** (1 egység), mellette vendégház.
  - 4–8 fő → **vendégház elöl**, mellette **2 apartman** (ár szorzódik; egységenként
    `ceil(fő/2)` fő szerinti apartman-ár).
- **>8 fő:** csak apartman, `qty = ceil(fő/4)`, fix `60 €/éj` (a meglévő kerekítés —
  nem bonyolítjuk; a vendégház max 8 fő).
- **Felár** a tartomány **mindkét** végére: **1 éj +20%**, **2 éj +10%** (3+ éj: nincs).
- **Csak elérhető ajánlat jöhet:** ami nem szabad a naptárban, az **meg sem jelenik**
  (nincs per-ajánlat `available` flag). Vendégház csak ha `guestHouseFree`; apartman
  csak ha van elég szabad egység. Ha egyik sem szabad → **üres `quote` tömb**, és a
  top-level `available: false` jelzi a „nincs szabad szállás” esetet.
- **Elérhetőség nem 100%-os pontosság** — szándékosan egyszerű: ha 8-ból 2 szabad,
  lehet hogy 3-at ajánlunk. A foglalt egységek durva számából dolgozunk.

---

## 5. Végpontok

Minden válasz `application/json`. Pénzértékek EUR-ban.

### `POST /api/quote` — irányár + foglaltság

Bemenet: `{ "checkin": "2026-07-10", "checkout": "2026-07-14", "guests": 5 }`

Validáció (hibakód = kliens i18n-kulcs): `errCheckin`, `errPast`, `errMinAdvance`,
`errHorizon`, `errCheckout`, `errOrder`, `errMinNights`, `errMaxNights`, `errGuests`,
`errMaxGuests`. Bármely hiba → `422 { errors: [{ field, code, vars? }] }`.

Kimenet (a `quote` tömb az **elérhető** ajánlatokat tartalmazza, javaslati
sorrendben — **0–2 elem**; `available` = van-e egyáltalán ajánlat):
```json
{
  "id": "uuid", "available": true,
  "checkin": "2026-07-10", "checkout": "2026-07-14",
  "guests": 5, "nights": 4, "currency": "EUR",
  "quote": [
    { "type": "house",    "qty": 1, "perNightMin": 135, "perNightMax": 145,
      "totalMin": 540, "totalMax": 580 },
    { "type": "apartman", "qty": 2, "perNightMin": 60,  "perNightMax": 65,
      "totalMin": 480, "totalMax": 520 }
  ]
}
```
Ha a kért időpontra semmi nem szabad → `"available": false, "quote": []`.
Az `id` + a teljes válasz az in-memory `Map`-ba kerül; egy sor a `quotes.log`-ba.

### `POST /api/book` — foglalási kérelem

Bemenet: `{ "id": "uuid", "name", "email", "email2", "phone", "lang" }`.
Validáció: `errName`, `errEmail`, `errEmailMatch`, `errPhone`; ismeretlen `id` → 422.
Hatás: NDJSON log + plain-text e-mail a tulajnak (a tárolt quote-ból, **minden
ajánlattal**). Válasz: `{ "success": true }`.

### `GET /api/bookings?year=&month=` — a hónap foglalásai (admin)

Az átnyúlókkal együtt (`arrival < hónap_vége+1 AND departure >= hónap_eleje`),
a törölteket is (a kliens dönt a megjelenítésről).

### `POST /api/bookings` · `POST /api/bookings/:id` · `POST /api/bookings/:id/delete` (admin)

Ütközés-ellenőrzés (`409 { conflict }`), log-diff módosításkor, `deleted=1` törléskor.
Részletek: `server/db.js` (a naptár adatrétegének portja, változatlan szabályok).

### `GET /healthz` — `{ "ok": true }`

---

## 6. Adat & perzisztencia

- **Egyetlen `/data` volume:** `orwa.db` (+WAL) **és** `quotes.log`.
- A `bookings` séma és a szabályok az orwa-naptar adatrétegét követik
  (`accommodation` 0 = Vendégház, 1–8 = Apartman; `currency` HUF/EUR; `status`
  confirmed/tentative; soft-delete `deleted` flaggel; per-rekord JSON `log`).
- **Migráció élesben:** a meglévő prod `orwa.db` ma az `orwa_naptar_data` volume-on
  él → a deploynál ezt a volume-ot **az orwa-booking `/data`-jára kell átkötni**,
  hogy a valódi foglalások megmaradjanak. (Lásd DEPLOY — készülőben.)

---

## 7. Frontend follow-up — TODO (külön kör, nem ebben a menetben)

A kétajánlatos válasz miatt az **orwa-new** rates-flow-ját át kell írni:

- [ ] `assets/js/main.js` `initBooking`: a `quote` tömb **0–2 ajánlatának**
      renderelése (apartman vs. vendégház párhuzamosan). Üres tömb / `available:false`
      → „a kért időpontra nincs szabad szállás” üzenet. A korábbi `quote[0]`-ra építő
      logika nem elég.
- [ ] `data/i18n/{lang}.yaml` (mind a 8 nyelv): két ajánlathoz címkék + a mailto
      tárgy/törzs frissítése (a `{placeholder}`-ek megtartásával).
- [ ] `layouts/_default/rates.html`: a kétajánlatos megjelenítés markupja
      (a 3 lépéses flow: paraméterek → ajánlat(ok) → adatok).
- [ ] Eldöntendő: a vendég **választ-e** ajánlatot a `/api/book` előtt (akkor a
      kliens küldje a választott ajánlat indexét), vagy a tulaj dönt az e-mailből
      (jelenleg minden ajánlat bekerül az e-mailbe).

---

## 8. Lokális futtatás

```sh
nvm use                 # Node 24 (.nvmrc)
npm install
npm run dev             # SEED_DEMO=1 + node --watch, :8000
# vagy üres DB-vel:
npm start
```
