# Running Loskai locally (dev) against Caddy + AdGuard containers

Loskai runs on the host (uv + Vite); Caddy and AdGuard run as throwaway containers you
point it at. No domain, ACME token, or Proxmox needed — Caddy uses its internal CA.

**Prereqs:** Docker + Compose, [uv], Node 20+.

## 1. Start the Caddy + AdGuard rig

```bash
docker compose -f docker-compose.dev.yml up -d
```

This publishes Caddy's admin API on **:2019** and AdGuard on **:3000** (see
`docker-compose.dev.yml` for the port map).

## 2. Finish AdGuard's first-run setup

Open <http://localhost:3000>. In the wizard:

- **Admin Web Interface** — listen on `All interfaces`, port **3000**.
- **DNS server** — port **53** (stays inside the container; the rig doesn't publish it,
  since Loskai only uses AdGuard's REST API).
- Create an **admin username + password** — you'll give these to Loskai next.

## 3. Start the Loskai backend (terminal 1)

pydantic-settings reads process env, so export the config before launching:

```bash
export CADDY_ADMIN_URL=http://127.0.0.1:2019     # an IP host -> DNS answer IP auto-derives
export ADGUARD_URL=http://127.0.0.1:3000
export ADGUARD_USER=admin                        # what you set in step 2
export ADGUARD_PASSWORD=changeme                 # what you set in step 2
export BASE_DOMAIN=lvh.me                         # *.lvh.me resolves to 127.0.0.1 — handy
export LOSKAI_PASSWORD=devpass                    # or set it at first run in the UI
# Writable state dir — the default /opt/loskai is the prod path and isn't writable in dev.
export LOSKAI_DATA_DIR="$HOME/loskai-data"; mkdir -p "$LOSKAI_DATA_DIR"
export STACKS_DIR="$HOME/loskai-stacks"; mkdir -p "$STACKS_DIR"

cd backend
uv run uvicorn loskai.main:app --reload --port 8000
```

## 4. Start the frontend (terminal 2)

```bash
cd frontend
npm install        # first time only
npm run dev        # Vite on http://localhost:5173, proxies /api/* -> :8000
```

## 5. Try it

Open <http://localhost:5173> and log in with `LOSKAI_PASSWORD`.

- **Routing tab** — Caddy and AdGuard should both show healthy. Click **Assign URL**,
  e.g. prefix `test`, upstream `127.0.0.1:8000`. Loskai pushes the Caddy route and adds
  the AdGuard rewrite.
- **Verify it landed:**
  ```bash
  curl -s http://127.0.0.1:2019/config/apps/http/servers    # the route is in Caddy
  ```
  and in the AdGuard UI → **Filters → DNS rewrites** you'll see `test.lvh.me → 127.0.0.1`.
  (Loskai's Routing table also shows *synced* + *rewrite set*.)
- **Docker tab** — because the backend runs on your host, it uses your real Docker socket:
  you'll see your actual containers (including this rig), and stacks under `STACKS_DIR`.

## 6. Tear down

```bash
docker compose -f docker-compose.dev.yml down       # keep AdGuard config + Caddy certs
docker compose -f docker-compose.dev.yml down -v     # wipe them too
```

## Notes

- **`BASE_DOMAIN` is a Loskai-only setting in dev** — set it via the env above *or* on the
  Settings page in the UI. The dev Caddy uses an internal CA (a per-name cert on demand), so
  it doesn't need the domain. (Production is different: the real wildcard cert requires Caddy
  to know `BASE_DOMAIN` too.)
- **`CADDY_HOST_IP` isn't needed** here: `CADDY_ADMIN_URL` uses an IP (`127.0.0.1`), so the
  DNS-rewrite answer IP derives from it automatically.
- **Full name resolution** (actually browsing `https://test.lvh.me`) would need AdGuard's
  DNS port published (uncomment it in the compose, on a free host port) with your resolver
  pointed at it, plus Caddy's internal CA trusted — beyond a basic integration test.
  Verifying the route/rewrite landed (above) confirms the wiring.
- Prefer not to export each time? Put the block in a file and `set -a; source it; set +a`
  before running uvicorn (don't commit it — it holds the AdGuard password).

## Actually browsing a routed service

The rig publishes Caddy on **`:8443`** (https) and **`:8081`** (http), not the defaults —
so browse `https://<name>.lvh.me:8443`, not `https://<name>.lvh.me`. The upstream you
assign must be reachable **from inside the Caddy container**:

- A sibling compose service → by **name**, e.g. `adguard:3000` (not `localhost:3000` — that's
  Caddy's own container).
- A LAN target → by **IP**, e.g. `192.168.10.50:5000`.

Caddy serves an internal cert, so the browser will warn it's untrusted (expected). To make
it trusted, open the **certificate onboarding page** at <http://localhost:8081/> — it
detects your OS and walks you through installing Caddy's root CA. See
[certificate-setup.md](certificate-setup.md).

Or extract the dev root CA by hand and import it into your browser's Authorities:

```bash
docker exec loskai-dev-caddy cat /data/caddy/pki/authorities/local/root.crt > caddy-dev-root.crt
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Backend startup `PermissionError: '/opt/loskai'` | `LOSKAI_DATA_DIR` unset → defaulted to the prod path. Export it (step 3). |
| `curl …/config/apps/http/servers` → "invalid traversal path" | Caddy has no HTTP server yet. The dev Caddyfile's `*.localhost` placeholder creates one — recreate Caddy (`up -d`). |
| Browser "can't establish a connection" | Wrong port — use `:8443` (https) / `:8081` (http), not the defaults. |
| **502 Bad Gateway** | Caddy matched the route but can't reach the upstream. Use the container **service name** (`adguard:3000`) or a **LAN IP**, never `localhost`. Re-assign (delete + assign). |
| AdGuard wizard sent you to a dead port | You picked a web port the rig doesn't publish. Reset (`down -v`) and use **3000**, or republish the port you chose. |
| DNS port bind fails (`5353 address already in use`) | mDNS/avahi owns it. The rig doesn't publish DNS by default; only add it on a free host port if you want real resolution. |

## Going live (beyond the local test)

To use this for real, on your LAN with a real domain:

1. **Real domain + wildcard cert.** Use the production `docker-compose.yml` /
   `docker-compose.colocated.yml` (or the LXC script), where Caddy obtains a real
   `*.BASE_DOMAIN` cert via DNS challenge — so Caddy **does** need `BASE_DOMAIN` (and the
   DNS-provider token) in its own env, and must agree with Loskai's.
2. **Publish AdGuard's DNS port** (`:53`) on the LAN and free the host resolver if needed.
3. **Point devices at AdGuard for DNS** — set your router's DHCP to hand out the AdGuard
   IP, so every device uses it and the rewrites (`name.BASE_DOMAIN → Caddy LAN IP`) take
   effect. Remote peers do the same via the WireGuard tab's DNS reminder.

[uv]: https://docs.astral.sh/uv/
