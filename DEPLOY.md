# orwa-booking — deploy & üzemeltetés

Belső backend (Node + SQLite), publikált port és titok nélkül. A két frontend
(orwa-new content-Caddy, orwa-naptar Caddy) a saját proxy-rétegén át éri el. A
live stacket a [`../orwa-server`](../orwa-server) compose vezényli; a domain/TLS
az [`../orwa-edge`](../orwa-edge). Architektúra: [SPEC.md](SPEC.md).

## ECR registry & repók

Registry: `197795502251.dkr.ecr.eu-central-1.amazonaws.com` · régió: `eu-central-1`.

| Környezet | Image |
|---|---|
| **prod** | `orwa-booking` |
| **preprod** | `orwa-booking-pp` |

Minden push két taget kap: `:latest` és `:<BUILD>` (időbélyeg, rollbackhez).

### Egyszeri ECR-setup

```sh
aws ecr create-repository --repository-name orwa-booking    --region eu-central-1
aws ecr create-repository --repository-name orwa-booking-pp --region eu-central-1
```

## Build & push (a build-gépen, pl. Mac)

```sh
make login      # AWS ECR login (push előtt egyszer / token-lejáratkor)
make preprod    # → orwa-booking-pp  (linux/amd64, :latest + :<BUILD>)
make prod       # → orwa-booking
```

A `better-sqlite3` natív modul az amd64 build során fordul (Macen emulációval).

## A konténer futási kontraktusa (amit a proxyknak tudniuk kell)

| | |
|---|---|
| **Image** | `…/orwa-booking:latest` (prod) · `…/orwa-booking-pp:latest` (preprod) |
| **Konténer-/hálózati név** | `orwa-booking` (prod) · `orwa-booking-pp` (preprod) |
| **Port (befelé)** | `8000` (HTTP) |
| **Publikált host-port** | nincs — a proxyk a belső hálón, néven érik el |
| **Env** | `NODE_ENV=production`, `DB_PATH=/data/orwa.db` (nincs `SEED_DEMO` → üres DB) |
| **Volume** | `/data` (perzisztens — `orwa.db` + WAL; benne a `bookings` + `quote_requests` táblák) |
| **Titkok** | **nincs** (az e-mail auth nélkül megy, aspmx — lásd SPEC §5) |

**Útvonal-jogosultság (a proxy felelőssége):**
- `POST /api/quote`, `POST /api/book`, `GET /healthz` → **publikus** (orwa-new content-Caddy).
- `GET/POST /api/bookings*` → **csak auth mögött** (orwa-naptar Caddy). A content-Caddy
  ezt SOHA nem proxyzhatja. Lásd [SPEC.md §2](SPEC.md).

## ⚠️ Cutover — a meglévő foglalási adat MIGRÁLÁSA

A valódi `orwa.db` ma az `orwa-naptar` `/data`-ján (`orwa_naptar_data` volume) él.
Az átállásnál ezt a volume-ot **az orwa-booking `/data`-jára kötjük át** —
ugyanazon az `orwa-server` compose-projekten belül, így **nem kell adatot másolni**,
csak a mount gazdát vált. A részletes compose-változások az `../orwa-server`-ben;
a sorrend a szerveren:

```sh
# 0) BACKUP előbb — a volume-ban lévő orwa.db lementése (single-file SQLite).
docker run --rm -v orwa-server_orwa_naptar_data:/d -v "$PWD":/b alpine \
  sh -c 'cp /d/orwa.db /b/orwa.db.bak && echo mentve'

# 1) Build+push az új image-ek (ezen a gépen): orwa-booking + orwa-naptar (statikus).
#    (orwa-booking repó: make prod ; orwa-naptar repó: make prod)

# 2) A szerveren a frissített ../orwa-server/docker-compose.yml-lel:
cd ~/work/orwa-server
docker compose pull
docker compose up -d        # az orwa_naptar_data most az orwa-booking-ra mountol

# 3) Ellenőrzés:
docker exec orwa-booking ls -la /data            # orwa.db ott van-e
docker exec orwa-booking wget -qO- localhost:8000/healthz
#   - weboldal:  /api/quote ad-e ajánlatot
#   - naptar.orwa.hu:  belépés után a foglalások (valódi adat) látszanak-e
```

Preprod (`orwa-booking-pp`) **saját, külön** DB-volume-ot kap — a prod adatot nem érinti.

## Lokális futtatás (Docker nélkül)

```sh
make dev            # Express + minta-DB (SEED_DEMO=1), :8000
```

## Backup (TODO, távoli jövő)

Az `orwa.db` automatikus mentése Litestream-mel S3-ba — az app készen áll rá
(WAL mód, mountolt volume). Egyelőre: a fenti manuális `cp` a volume-ból.
