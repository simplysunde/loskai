# Caddy Admin API — Endpoints Loskai Uses

Loskai drives Caddy entirely through its [Admin API](https://caddyserver.com/docs/api)
(default `:2019`, firewalled to the Docker host). It never edits the Caddyfile per change —
the Caddyfile is a one-time bootstrap, and every route after that is a live API mutation.

This document is the contract: the exact subset of the API the Caddy module calls, why,
and what it sends. Anything not listed here, Loskai does not touch.

---

## Data model recap

Every route Loskai manages is a **flat, top-level route** in one HTTP server's `routes`
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

Returns the servers object; Loskai reads its single key (e.g. `srv0`) and caches it as
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

### 4. Edit a route (upstream / prefix changed)

Editing is **delete-then-add**, not an in-place update:

```
DELETE /id/grafana            # ignore 404 — the route may not be pushed yet
POST   …/servers/<server>/routes   # re-add with the new upstream/host
```

Caddy does have `PATCH /id/<id>`, but it *strictly replaces and errors if the target
doesn't exist* — so using it would force the code to first know whether the route is
already live (POST-if-new vs PATCH-if-exists). Delete-then-add is a single code path that
always converges, reuses the same add call as everything else, and is idempotent because
the `@id` is the stable instance `id`. The only cost is a sub-second gap while the route is
absent, which is irrelevant for a config change the user just initiated.

### 5. Push all — rebuild every route from `instances.json`

The `POST …/push` operation behind the UI's **Sync** button (which also runs the AdGuard
reconcile). Backstop for when Caddy has lost its config (fresh instance, wiped autosave).
Rebuilds the full route set from Loskai's instance list. Two equivalent strategies:

- **Per route:** `POST …/routes` for each instance that has a subdomain. Idempotent by
  `@id` — re-pushing an existing route replaces it rather than duplicating.
- **Whole config:** `POST /load` with a complete config document. Heavier hammer; replaces
  everything at once. Prefer the per-route loop so any human-added route with a non-instance
  `@id` is left untouched (see [Ownership](#ownership--what-loskai-manages)).

### 6. Read current routes / raw config

```
GET /config/apps/http/servers/<server>/routes    # the live route list
GET /config/                                      # full config (Raw Config View, debug)
```

Used to render the read-only Raw Config View, and to compute each route's **synced**
status: Loskai pulls the live route list and checks whether each instance's `@id` is
present. Present = synced; missing = not pushed. This is a **display-only comparison** —
Loskai never auto-corrects a mismatch (that would be the drift/reconcile loop we
deliberately dropped); it just surfaces the "Sync" action when something is missing.

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
**no action from Loskai**: the routes come back from Caddy's own autosave.

"Sync" (endpoint #5, plus the AdGuard reconcile) is the **rare-case** backstop, only for
when the autosave itself is gone or stale: a freshly provisioned Caddy, a wiped data dir, a
hand-reset config. In that case `instances.json` is the durable record we rebuild from.

---

## Ownership — what Loskai manages

Loskai manages every route whose `@id` matches an instance `id`. That now includes its
own UI and AdGuard, since both are ordinary instances (Loskai is a discovered container;
AdGuard is a seeded `external` instance) rather than hand-written Caddyfile routes. The
bootstrap Caddyfile defines **no routes** — only the admin endpoint and the wildcard cert.

The only thing Loskai leaves alone is a route a human adds directly to Caddy with an
`@id` that matches no instance. The per-route push loop preserves such a route; a
blunt `POST /load` would wipe it, which is one reason the loop is preferred.

---

## Not used

For clarity, endpoints Loskai deliberately does **not** call:

- `POST /stop` — never shuts Caddy down.
- `PATCH /id/<id>` — editing is done as delete-then-add (endpoint #4), so PATCH is unused.
- `PUT /config/...` (insert-at-index) — not needed; specific-host routes are
  order-independent, so append is always sufficient.
- `POST /adapt` — unused; Loskai manages routes as JSON via the config endpoints and no
  longer renders a Caddyfile at all (that export was removed — the bootstrap Caddyfile ships
  in the repo instead).
- Cert / PKI endpoints (`GET /pki/...`) — confirmed dead end for our cert. The PKI
  endpoints cover only Caddy's internal `local` CA (returning PEM blobs, no structured
  expiry), and the public wildcard cert is never exposed at `/config` or `/pki`. The
  Certificate Status feature is **deferred**; when revisited it will use a TLS probe to a
  routed name (read the served cert's `notAfter`), not the Admin API. See PLAN.md Future Ideas.
