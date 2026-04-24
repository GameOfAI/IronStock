.PHONY: help up down logs ps \
	build build-server build-web build-client \
	test test-server test-web test-client \
	lint lint-server lint-web lint-client \
	fmt fmt-server fmt-web fmt-client \
	migrate-up migrate-down \
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
test: test-server test-web test-client ## Tüm testleri çalıştır

test-server:
	cd server && go test ./...

test-web:
	cd web && npm test

test-client:
	cd client && npm test

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
migrate-up: ## DB migration'ları uygula (Faz 1 sonrası)
	cd server && go run ./cmd/migrate up

migrate-down: ## Son migration'ı geri al
	cd server && go run ./cmd/migrate down

# ---------- Cleanup ----------
clean: ## Build artifact'lerini temizle
	rm -rf server/bin server/dist \
		web/dist web/node_modules \
		client/dist client/node_modules \
		client/src-tauri/target
