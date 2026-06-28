# ============================================================
# ORWA Booking — build & push (az orwa-naptar/orwa-new mintájára).
# A `prod`/`preprod` a megfelelő compose `build:` szekciója alapján buildeli+
# pusholja az image-et az ECR-be (docker buildx bake … --push, linux/amd64).
# A szerver-oldali deploy + a proxy-integráció: DEPLOY.md.
# ============================================================

# image-tag időbélyeg (yymmddHHMM, rollbackhez) — SAJÁT sorban a komment.
export BUILD = $(shell date +%y%m%d%H%M)

# ECR registry (közös fiók/régió). Csak az ECR-login használja; a teljes
# image-utak a compose fájlokban vannak.
REGISTRY := 197795502251.dkr.ecr.eu-central-1.amazonaws.com

# Csupasz `make` csak a súgót írja ki — ne pusholjon véletlenül ECR-be.
help:
	@echo "make dev      → LOKÁLIS dev szerver (Express, minta-DB), :8000  (node, nincs Docker)"
	@echo "make preprod  → preprod image build + push (orwa-booking-pp)"
	@echo "make prod     → prod image build + push (orwa-booking)"
	@echo "make login    → AWS ECR login (push előtt)"

# --- LOKÁLIS dev (Docker nélkül): Express + minta-DB, node --watch, :8000. ---
dev:
	npm install
	npm run dev

# --- Preprod: a preprod image (orwa-booking-pp) build + push. ---
preprod:
	docker buildx bake -f docker-compose.preprod.yml --push

# --- Prod: a prod image (orwa-booking) build + push. ---
prod:
	docker buildx bake -f docker-compose.prod.yml --push

login:
	aws ecr get-login-password --region eu-central-1 \
		| docker login --username AWS --password-stdin $(REGISTRY)

.PHONY: help dev preprod prod login
