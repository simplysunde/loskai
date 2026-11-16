# Loskai — single image: FastAPI serves the API and the built React bundle on :8080.

# --- Stage 1: build the frontend bundle ---
# On the machine that builds, whatever platform the image is for: the bundle is the same
# JavaScript everywhere, and `npm ci` and Vite under emulation took most of an arm64 build.
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build            # -> /app/dist

# --- Stage 2: Python runtime ---
# Pinned to bookworm so the Docker apt repo line below (…/debian bookworm stable) always
# matches the base OS — a floating slim tag could move to a newer Debian and break it.
FROM python:3.12-slim-bookworm
# Links the published image to its repository.
LABEL org.opencontainers.image.source=https://github.com/simplysunde/loskai
WORKDIR /app

# uv; installs are reproducible from uv.lock (--frozen below).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_PREFERENCE=only-system

# git (recipe sync + git_build recipes) + the Docker CLI and Compose v2 plugin
# (the daemon lives on the host; we only mount its socket). From Docker's apt repo.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg git \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends \
        docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first (cached across source changes). --no-install-project skips
# building loskai itself until its source is present.
COPY backend/pyproject.toml backend/uv.lock backend/README.md ./
RUN uv sync --frozen --no-dev --no-install-project

# Project source, then install loskai into the venv.
COPY backend/src ./src
RUN uv sync --frozen --no-dev

# The built bundle, served as static files (config default: static_dir="static").
COPY --from=frontend /app/dist ./static
# Readable by the user the app drops to (see the entrypoint), whatever mode the files had
# in the working tree they were copied from.
RUN chmod -R a+rX src static

# State lives on the bind mount, stated here rather than left to the config default:
# that default is anchored to the source tree's root, which lands on `/` in this image
# only by accident of how deep `src/loskai/` sits. Every compose file passes this too;
# this is what makes a plain `docker run -v ./data:/data` correct as well.
ENV LOSKAI_DATA_DIR=/data

# Starts as root only to run the app as whoever owns ./data — see the script.
COPY scripts/container-entrypoint.sh /usr/local/bin/loskai-entrypoint
ENTRYPOINT ["loskai-entrypoint"]

EXPOSE 8080
# --no-sync: never touch the locked env at runtime (it's already synced).
CMD ["uv", "run", "--no-sync", "uvicorn", "loskai.main:app", "--host", "0.0.0.0", "--port", "8080"]
