# Caddy Admin API — Endpoints FlytDokk Uses

FlytDokk drives Caddy entirely through its [Admin API](https://caddyserver.com/docs/api)
(default `:2019`, firewalled to the Docker host). It never edits the Caddyfile per change —
the Caddyfile is a one-time bootstrap, and every route after that is a live API mutation.

This document is the contract: the exact subset of the API the Caddy module calls, why,
and what it sends. Anything not listed here, FlytDokk does not touch.

---

## Data model recap

Every route FlytDokk manages is a **flat, top-level route** in one HTTP server's `routes`
array, keyed by `@id` = the instance's `id`. There is no nesting under a wildcard site
block; each route is an independent sibling matching a single host. This is what makes the
`@id` endpoints below idempotent — one `@id`, one route, add/replace/delete by that key.

The server name (`srv0` in a stock Caddyfile adaptation) is **discovered at startup**, not
hardcoded — see [Server name discovery](#server-name-discovery).

---

## Endpoints

### 1. Discover the server name

```
GET /config/apps/http/servers
```

Returns the servers object; FlytDokk reads its single key (e.g. `srv0`) and caches it as
`<server>` for the paths below. Done once on startup so nothing hardcodes `srv0`.

### 2. Add / assign a route

```
POST /config/apps/http/servers/<server>/routes
Content-Type: application/json
```

The `routes` destination is an array, so **POST appends**. Body is one route object
carrying its `@id`:

```json
{
  "@id": "grafana",
  "match": [{ "host": ["grafana.example.no"] }],
  "handle": [{
    "handler": "subroute",
    "routes": [{
      "handle": [{
        "handler": "reverse_proxy",
        "upstreams": [{ "dial": "192.168.10.100:3000" }]
      }]
    }]
  }]
}
```

Because the host is a single specific name (never a wildcard), append order does not
matter — sibling routes with disjoint hosts are order-independent.

### 3. Delete a route

```
DELETE /id/grafana
```

`@id` addressing: removes the entire route object whose `@id` is `grafana`, wherever it
sits. Used when a subdomain is cleared or an instance is deleted.

### 4. Update a route in place (upstream / host changed)

```
PATCH /id/grafana
Content-Type: application/json
```

PATCH strictly replaces the existing object. Body is the full route object (same shape as
the POST body). Used when an assigned instance's upstream or prefix changes without
tearing the route down first.

> An equivalent, simpler path is **`DELETE /id/grafana` then re-`POST`**. Because the
> instance `id` is reused as the `@id`, both approaches are idempotent and converge on the
> same result. FlytDokk may use either; PATCH avoids a momentary gap in the route.

### 5. Push all — rebuild every route from `instances.json`

Backstop for when Caddy has lost its config (fresh instance, wiped autosave). Rebuilds
the full route set from FlytDokk's instance list. Two equivalent strategies:

- **Per route:** `POST …/routes` for each instance that has a subdomain. Idempotent by
  `@id` — re-pushing an existing route replaces it rather than duplicating.
- **Whole config:** `POST /load` with a complete config document. Heavier hammer; replaces
  everything at once. Prefer the per-route loop so the static bootstrap routes are left
  untouched (see [Ownership](#ownership--what-flytdokk-will-not-touch)).

### 6. Read current routes / raw config

```
GET /config/apps/http/servers/<server>/routes    # the live route list
GET /config/                                      # full config (Raw Config View, debug)
```

Used to render the route table's live/synced state and the read-only Raw Config View.

### 7. Upstream health

```
GET /reverse_proxy/upstreams
```

Reports each proxy backend's status (up/down, request count). Surfaced per row in the
route list.

---

## Persistence — how routes survive a restart

Caddy **autosaves the full config to disk after every API change** (unless disabled). The
service runs with `caddy run --resume`, which reloads that autosave on start. So the
normal recovery path — LXC reboot, Proxmox restart, Caddy crash + systemd restart — needs
**no action from FlytDokk**: the routes come back from Caddy's own autosave.

"Push all to Caddy" (endpoint #5) is the **rare-case** backstop, only for when the autosave
itself is gone or stale: a freshly provisioned Caddy, a wiped data dir, a hand-reset
config. In that case `instances.json` is the durable record we rebuild from.

---

## Ownership — what FlytDokk will not touch

FlytDokk only manages routes whose `@id` matches an instance `id`. The static bootstrap
routes (FlytDokk's own UI, AdGuard) are defined in the Caddyfile and carry no
FlytDokk-owned `@id`, so the add/delete/patch calls above never address them. The
per-route "Push all" loop preserves them; a blunt `POST /load` would not, which is why the
loop is preferred.

---

## Not used

For clarity, endpoints FlytDokk deliberately does **not** call:

- `POST /stop` — never shuts Caddy down.
- `PUT /config/...` (insert-at-index) — not needed; specific-host routes are
  order-independent, so append is always sufficient.
- `POST /adapt` — FlytDokk renders its Caddyfile export from its own instance list, not by
  round-tripping through Caddy (there is no JSON → Caddyfile converter anyway).
- Cert / PKI endpoints (`GET /pki/...`) — cert metadata is **not** exposed at
  `/config`; whether expiry is reachable at all via the Admin API is unconfirmed, so the
  Certificate Status feature is on hold pending verification.
