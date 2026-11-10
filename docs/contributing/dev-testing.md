[Docs](../README.md) › [Contributing](../README.md#contributing)

# Running Loskai locally (dev) against Caddy + AdGuard containers

**Read this when** you want to run Loskai from source and change it.

Loskai runs on the host (uv + Vite); Caddy and AdGuard run as throwaway containers you
point it at. No domain, ACME token, or Proxmox needed — Caddy uses its internal CA.

**Prereqs:** Docker + Compose, [uv], Node 20.19+ or 22.12+ (Vite's minimum).

> **Already running Loskai from this checkout?** `make live` runs the working tree in its
> container instead of the built image — the same `compose.yml`, `.env` and `./data`, with
> `compose.build.yml` (build from this checkout) and `compose.live.yml` on top. The backend restarts when a `.py` file is saved and the page
> on `:8080` updates as the frontend is edited, with no rebuild. A backend restart closes
> open terminals and locks the SSH key again. `bash scripts/deploy.sh` goes back to the
> built image. The rest of this page is for a Loskai of its own, beside test containers.

## 1. Start the Caddy + AdGuard rig

```bash
docker compose -f compose.dev.yml up -d
```

This publishes Caddy's admin API on **:2019** and AdGuard on **:3000** (see
`compose.dev.yml` for the port map).

## 2. Finish AdGuard's first-run setup

Open <http://localhost:3000>. In the wizard:

- **Admin Web Interface** — listen on `All interfaces`, port **3000**.
- **DNS server** — port **53** (stays inside the container; the rig doesn't publish it,
  since Loskai only uses AdGuard's REST API).
- Create an **admin username + password** — you'll give these to Loskai next.

## 3. Start the Loskai backend (terminal 1)

`config.py` reads a `.env` at the **repo root** (resolved from `config.py`'s own
location, so it's found regardless of which directory you run `uv run` from). Create
one there — it's gitignored, never committed:

```bash
# .env at the repo root
CADDY_ADMIN_URL=http://127.0.0.1:2019     # an IP host -> DNS answer IP auto-derives
ADGUARD_URL=http://127.0.0.1:3000
ADGUARD_USER=admin                        # what you set in step 2
ADGUARD_PASSWORD=changeme                 # what you set in step 2
BASE_DOMAIN=lvh.me                        # *.lvh.me resolves to 127.0.0.1 — handy
LOSKAI_PASSWORD=devpass                   # or set it at first run in the UI
LOSKAI_USERNAME=admin                     # the first account's name (default admin)
# Neither LOSKAI_DATA_DIR nor STACKS_DIR is needed here: both default to the repo's own
# data/ and stacks/, which are tracked. Set LOSKAI_DATA_DIR only to keep state elsewhere.
```

```bash
cd backend
uv run uvicorn loskai.main:app --reload --port 8000
```

Exporting the same variables in your shell instead works too (env vars still take
priority over `.env`) — handy for CI or a one-off override without touching the file.

> **Don't run this alongside a Loskai container on the same machine.** Compose mounts
> `./data:/data`, which is the very directory the dev backend now defaults to, so both
> processes would be read-modify-writing `settings.json` and `instances.json`. The lock
> in `shared/store.py` is per-process and can't serialise that — one side's write is
> silently lost. Stop the container, or point `LOSKAI_DATA_DIR` somewhere else.

## 4. Start the frontend (terminal 2)

```bash
cd frontend
npm install        # first time only
npm run dev        # Vite on http://localhost:5173, proxies /api/* -> :8000
```

## 5. Try it

Open <http://localhost:5173> and log in as `admin` (or `LOSKAI_USERNAME`) with `LOSKAI_PASSWORD`.

- **Routing tab** — Caddy and AdGuard should both show healthy. Click **Add route** → the
  **External** source, e.g. prefix `test`, upstream `adguard:3000`. (The **Container** and
  **Machines** sources pre-fill from a live container / what runs on a machine.) Loskai
  pushes the Caddy route and adds the AdGuard rewrite.
- **Verify it landed:**
  ```bash
  curl -s http://127.0.0.1:2019/config/apps/http/servers    # the route is in Caddy
  ```
  and in the AdGuard UI → **Filters → DNS rewrites** you'll see `test.lvh.me → 127.0.0.1`.
  (Loskai's Routing table also shows *synced* + *set*.)
- **Docker tab** — because the backend runs on your host, it uses your real Docker socket:
  you'll see your actual containers (including this rig), and stacks under `STACKS_DIR`.

## 6. Tear down

```bash
docker compose -f compose.dev.yml down       # keep AdGuard config + Caddy certs
docker compose -f compose.dev.yml down -v     # wipe them too
```

## Notes

- **`BASE_DOMAIN` is a Loskai-only setting in dev** — set it via the env above *or* on the
  Settings page in the UI. Caddy never needs it — here or in production, which run the same
  `caddy/Caddyfile`: each routed name gets its own cert as its route lands.
- **`CADDY_HOST_IP` isn't needed** here: `CADDY_ADMIN_URL` uses an IP (`127.0.0.1`), so the
  DNS-rewrite answer IP derives from it automatically.
- **Full name resolution** (actually browsing `https://test.lvh.me`) would need AdGuard's
  DNS port published (uncomment it in the compose, on a free host port) with your resolver
  pointed at it, plus Caddy's internal CA trusted — beyond a basic integration test.
  Verifying the route/rewrite landed (above) confirms the wiring.

## Actually browsing a routed service

The rig publishes Caddy on **`:8443`** (https) and **`:8081`** (http), not the defaults —
so browse `https://<name>.lvh.me:8443`, not `https://<name>.lvh.me`. The upstream you
assign must be reachable **from inside the Caddy container**:

- A sibling compose service → by **name**, e.g. `adguard:3000` (not `localhost:3000` — that's
  Caddy's own container).
- A LAN target → by **IP**, e.g. `192.168.10.50:5000`.

Caddy serves an internal cert, so the browser will warn it's untrusted (expected). To make
it trusted, open the **certificate onboarding page** at <http://127.0.0.1:8081/> — it
detects your OS and walks you through installing Caddy's root CA. See
[certificate-setup.md](../guides/certificate-setup.md).

Or extract the dev root CA by hand and import it into your browser's Authorities:

```bash
docker exec loskai-dev-caddy cat /data/caddy/pki/authorities/local/root.crt > caddy-dev-root.crt
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Backend startup `PermissionError: '/data'` | A stale `LOSKAI_DATA_DIR=/data` in your `.env` (or exported in your shell) — that's the in-container path, which you can't write to from the host. Unset it and let it default to the repo's `data/`. |
| Backend startup `PermissionError` on the repo's own `data/` or `stacks/` | An older, root-run Loskai left them root-owned (the container now runs as the owner of `./data`, and hands such files back when it starts). `sudo chown -R "$USER" data stacks`. |
| `curl …/config/apps/http/servers` → "invalid traversal path" | Caddy has no HTTP server yet. The Caddyfile's `localhost` site creates one — recreate Caddy (`up -d`). |
| Browser "can't establish a connection" | Wrong port — use `:8443` (https) / `:8081` (http), not the defaults. |
| **502 Bad Gateway** | Caddy matched the route but can't reach the upstream. Use the container **service name** (`adguard:3000`) or a **LAN IP**, never `localhost`. Re-assign (delete + assign). |
| AdGuard wizard sent you to a dead port | You picked a web port the rig doesn't publish. Reset (`down -v`) and use **3000**, or republish the port you chose. |
| DNS port bind fails (`5353 address already in use`) | mDNS/avahi owns it. The rig doesn't publish DNS by default; only add it on a free host port if you want real resolution. |

## Going live (beyond the local test)

To use this for real on your LAN:

1. **TLS.** Production uses the same internal CA as dev — deploy the production
   `compose.yml` / `compose.colocated.yml` (or the LXC script) and install Caddy's root on
   each device once via the [onboarding page](../guides/certificate-setup.md).
2. **Publish AdGuard's DNS port** (`:53`) on the LAN and free the host resolver if needed.
3. **Point devices at AdGuard for DNS** — set your router's DHCP to hand out the AdGuard
   IP, so every device uses it and the rewrites (`name.BASE_DOMAIN → Caddy LAN IP`) take
   effect. Remote peers do the same via the WireGuard DNS reminder in Settings › Network.

[uv]: https://docs.astral.sh/uv/
