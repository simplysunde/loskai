.PHONY: help live backend frontend install-backend install-frontend test-backend test-frontend check-docs

help:
	@echo "make live              - run the working tree in the loskai container, live-reloading on :8080"
	@echo "make backend           - start backend dev server (uvicorn, :8000)"
	@echo "make frontend          - start frontend dev server (vite, :5173)"
	@echo "make install-backend   - uv sync"
	@echo "make install-frontend  - npm install"
	@echo "make test-backend      - uv run pytest"
	@echo "make test-frontend     - npm test"
	@echo "make check-docs        - validate doc links, anchors and orphans"

live:
	docker compose -f compose.yml -f compose.live.yml up -d --build

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
