.PHONY: help backend frontend install-backend install-frontend test-backend test-frontend

help:
	@echo "make backend           - start backend dev server (uvicorn, :8000)"
	@echo "make frontend          - start frontend dev server (vite, :5173)"
	@echo "make install-backend   - uv sync"
	@echo "make install-frontend  - npm install"
	@echo "make test-backend      - uv run pytest"
	@echo "make test-frontend     - npm test"

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
