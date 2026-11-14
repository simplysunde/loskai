.PHONY: help dev release demo backend frontend install-backend install-frontend test-backend test-frontend check-docs check-phone

help:
	@echo "make dev               - run the working tree in the loskai container, live-reloading on :8080"
	@echo "make backend           - start backend dev server (uvicorn, :8000)"
	@echo "make frontend          - start frontend dev server (vite, :5173)"
	@echo "make install-backend   - uv sync"
	@echo "make install-frontend  - npm install"
	@echo "make test-backend      - uv run pytest"
	@echo "make test-frontend     - npm test"
	@echo "make check-docs        - validate doc links, anchors and orphans, and the docs against the code"
	@echo "make check-phone       - screenshot a running Loskai at phone widths (LOSKAI_USER, LOSKAI_PASSWORD; URL=…)"
	@echo "make release VERSION=x.y.z - build both images (amd64 + arm64) and push them (LOSKAI_REGISTRY=…)"
	@echo "make demo              - record the README's animations in a made-up homelab (ONLY=…, KEEP=1, DEMO_RECIPES=…)"

dev:
	docker compose -f compose.yml -f compose.build.yml -f compose.dev.yml up -d --build

release:
	bash scripts/release.sh $(VERSION)

demo:
	bash scripts/record-demo.sh

backend:
	cd backend && uv run uvicorn loskai.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

install-backend:
	cd backend && uv sync

install-frontend:
	cd frontend && npm install

test-backend:
	cd backend && uv run pytest

test-frontend:
	cd frontend && npm test

check-docs:
	bash scripts/check-docs.sh

check-phone:
	bash scripts/check-phone.sh $(URL)
