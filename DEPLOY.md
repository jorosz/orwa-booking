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
| **Env** | `NODE_ENV=production`, `DB_PATH=/data/orwa.db` (nincs `SEED_DEMO` → üres DB); backuphoz: `BACKUP_BUCKET`, `AWS_REGION` (lásd [BACKUP.md](BACKUP.md)) |
| **Volume** | `/data` (perzisztens — `orwa.db` + WAL; benne a `bookings` + `quote_requests` táblák) |
| **Titkok** | az e-mail auth nélkül megy (aspmx, SPEC §5). **Egyetlen titok** a backup-hoz: `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (IAM user, csak `s3:PutObject`) — `env_file`-ból, lásd [BACKUP.md](BACKUP.md) |

**Útvonal-jogosultság (a proxy felelőssége):**
- `POST /api/quote`, `POST /api/book`, `GET /healthz` → **publikus** (orwa-new content-Caddy).
- `GET/POST /api/bookings*` → **csak auth mögött** (orwa-naptar Caddy). A content-Caddy
  ezt SOHA nem proxyzhatja. Lásd [SPEC.md §2](SPEC.md).


## Lokális futtatás (Docker nélkül)
```sh
make dev            # Express + minta-DB (SEED_DEMO=1), :8000
```

## Backup & archiválás
Napi `VACUUM INTO` snapshot → S3 (30 napos retenció), törölt foglalások végleges
törlése a `departure` után, quote_requests PII anonimizálás 3 hónap után. Részletek:
[BACKUP.md](BACKUP.md). Egyelőre, amíg ez nincs élesítve: a fenti manuális `cp` a volume-ból.
