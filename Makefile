.PHONY: help up down logs ps \
	build build-server build-web build-client \
	test test-server test-web test-client test-integration \
	lint lint-server lint-web lint-client lint-openapi \
	fmt fmt-server fmt-web fmt-client \
	migrate-up migrate-down migrate-status migrate-redo \
	gen gen-sqlc gen-oapi-go gen-oapi-ts gen-check \
	tools-install \
	sealed-secrets-install sealed-secrets-fetch-cert seal-secret \
	clean

.DEFAULT_GOAL := help

COMPOSE := docker compose -f deploy/compose/docker-compose.yml

help: ## Komut listesini göster
	@echo "Envanter App — Makefile"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

# ---------- Dev Stack ----------
up: ## Dev stack'i başlat (Postgres + Adminer + Mailhog)
	$(COMPOSE) up -d

down: ## Dev stack'i kapat (volume'ler korunur)
	$(COMPOSE) down

logs: ## Dev stack log'larını izle
	$(COMPOSE) logs -f

ps: ## Dev stack servislerini listele
	$(COMPOSE) ps

# ---------- Build ----------
build: build-server build-web build-client ## Tüm komponentleri build et

build-server: ## Server binary'sini build et
	cd server && go build -o bin/api ./cmd/api

build-web: ## Admin web UI build et
	cd web && npm run build

build-client: ## Tauri client'ı build et (Win+Mac)
	cd client && npm run tauri build

# ---------- Test ----------
test: test-server test-web test-client ## Tüm unit testleri çalıştır

test-server:
	cd server && go test ./...

test-web:
	cd web && npm test

test-client:
	cd client && npm test

test-integration: ## Server integration testleri (Docker + Postgres testcontainers)
	cd server && go test -tags=integration -timeout=10m -v ./internal/db/...

# ---------- Lint ----------
lint: lint-server lint-web lint-client ## Tüm linter'ları çalıştır

lint-server:
	cd server && golangci-lint run ./...

lint-web:
	cd web && npm run lint

lint-client:
	cd client && npm run lint && cd src-tauri && cargo clippy -- -D warnings

# ---------- Format ----------
fmt: fmt-server fmt-web fmt-client ## Tüm kodu formatla

fmt-server:
	cd server && gofmt -w .

fmt-web:
	cd web && npm run format

fmt-client:
	cd client && npm run format && cd src-tauri && cargo fmt

# ---------- DB Migration ----------
migrate-up: ## DB migration'ları uygula
	cd server && goose -dir migrations postgres "$$ENVANTER_DB_URL" up

migrate-down: ## Son migration'ı geri al
	cd server && goose -dir migrations postgres "$$ENVANTER_DB_URL" down

migrate-status: ## Migration durumu
	cd server && goose -dir migrations postgres "$$ENVANTER_DB_URL" status

migrate-redo: ## Son migration'ı down + up
	cd server && goose -dir migrations postgres "$$ENVANTER_DB_URL" redo

# ---------- Code Generation ----------
gen: gen-sqlc gen-oapi-go gen-oapi-ts ## Tüm üretilen kodu yeniden üret (sqlc + oapi-codegen + openapi-typescript)

gen-sqlc: ## sqlc: SQL → Go (DB layer)
	cd server && sqlc generate

gen-oapi-go: ## oapi-codegen: OpenAPI → Go handler interface
	cd server && oapi-codegen -config oapi-codegen.yaml ../shared/api/openapi.yaml

gen-oapi-ts: ## openapi-typescript: OpenAPI → TypeScript types (web + client)
	cd web && npx --yes openapi-typescript@latest ../shared/api/openapi.yaml -o src/api/schema.gen.ts
	cd client && npx --yes openapi-typescript@latest ../shared/api/openapi.yaml -o src/api/schema.gen.ts

gen-check: gen ## CI: üretilen kod güncel mi (diff boş olmalı)
	git diff --exit-code -- server/internal/db/sqlcgen server/internal/httpapi/apigen \
		web/src/api/schema.gen.ts client/src/api/schema.gen.ts \
		|| (echo "Generated code drifted. Run 'make gen' and commit."; exit 1)

lint-openapi: ## OpenAPI spec lint (Redocly)
	npx --yes @redocly/cli@latest lint shared/api/openapi.yaml

# ---------- Tool Installation ----------
tools-install: ## Go tool'larını kur (sqlc, oapi-codegen, goose, golangci-lint)
	go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.27.0
	go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.3.0
	go install github.com/pressly/goose/v3/cmd/goose@v3.22.0
	go install github.com/golangci/golangci-lint/cmd/golangci-lint@v1.55.2

# ---------- Sealed Secrets ----------
sealed-secrets-install: ## Bitnami Sealed Secrets controller'ı cluster'a kur
	kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.26.0/controller.yaml
	kubectl -n kube-system rollout status deploy/sealed-secrets-controller --timeout=60s

sealed-secrets-fetch-cert: ## Controller public cert'ini çek → deploy/k8s/pub-cert.pem
	kubeseal --fetch-cert \
	  --controller-name=sealed-secrets-controller \
	  --controller-namespace=kube-system \
	  > deploy/k8s/pub-cert.pem
	@echo "Cert kaydedildi: deploy/k8s/pub-cert.pem — git'e commit et"

seal-secret: ## deploy/k8s/secret.yaml → secret.sealed.yaml (pub-cert.pem gerekli)
	@test -f deploy/k8s/secret.yaml || \
	  (echo "HATA: deploy/k8s/secret.yaml bulunamadı. secret.yaml.example'dan kopyala."; exit 1)
	@test -f deploy/k8s/pub-cert.pem || \
	  (echo "HATA: pub-cert.pem bulunamadı. make sealed-secrets-fetch-cert çalıştır."; exit 1)
	kubeseal --cert deploy/k8s/pub-cert.pem --format yaml \
	  < deploy/k8s/secret.yaml \
	  > deploy/k8s/secret.sealed.yaml
	@echo "Sealed secret oluşturuldu. kustomization.yaml'da uncomment et ve commit et."

# ---------- Cleanup ----------
clean: ## Build artifact'lerini temizle
	rm -rf server/bin server/dist \
		web/dist web/node_modules \
		client/dist client/node_modules \
		client/src-tauri/target
