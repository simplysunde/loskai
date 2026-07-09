# AdGuard Home REST API — Endpoints FlytDokk Uses

FlytDokk talks to AdGuard Home through its
[REST API](https://github.com/AdguardTeam/AdGuardHome/blob/master/openapi/openapi.yaml)
(the same API its own web UI is built on). All paths are under the `/control` base
(so `ADGUARD_URL` = `http://192.168.10.101:3000`, and a call to "rewrite list" is
`GET http://192.168.10.101:3000/control/rewrite/list`).

FlytDokk is a **thin companion** to AdGuard, not a replacement for its UI. It touches
exactly one feature area — **DNS rewrites** — plus a status probe. Everything else
(query logs, blocklists, clients, DHCP, TLS, upstreams) is left to AdGuard's own UI,
which FlytDokk links out to. This document is the contract: the subset we call, and why.

---

## Authentication

The API's security scheme is HTTP **Basic Auth** (`basicAuth`, applied globally). Every
request carries `Authorization: Basic <base64(user:password)>` from `ADGUARD_USER` /
`ADGUARD_PASSWORD`. There is a cookie-based `POST /control/login` flow as well, but Basic
Auth is per-request and stateless — no session to establish or refresh — so that is what
FlytDokk uses.

---

## Data model recap

A DNS rewrite in AdGuard is a flat object (`RewriteEntry`):

```json
{ "domain": "grafana.example.no", "answer": "192.168.10.101", "enabled": true }
```

- **`domain`** — the name to intercept. Supports wildcards (`*.example.no`).
- **`answer`** — the A/AAAA/CNAME value the name resolves to.
- **`enabled`** — optional; omitted on add defaults to `true`. FlytDokk always omits it.

Two things follow from this that shape the whole module:

**1. A rewrite has no ID — its identity is the `(domain, answer)` pair.** There is no
handle to address one by. `POST /control/rewrite/delete` takes the *full entry back*, not
a key. So to delete a rewrite FlytDokk must reproduce both fields exactly.

**2. `answer` is a single deployment-wide constant: the reverse-proxy (Caddy) IP.** DNS
only resolves a *name to an address* — it does not know about ports. Every routed name
(`grafana.example.no`, `nextcloud.example.no`, …) must resolve to the one IP where Caddy
listens for `:443`; Caddy then reverse-proxies to each instance's real `host:port`
upstream. So the rewrite's `answer` is **not** the instance's upstream — it is the same
Caddy front IP for every rewrite, identical to the wildcard's answer.

> **Open item — where the answer IP comes from.** In the preferred topology Caddy runs on
> LXC 101 (`192.168.10.101`), so the answer is `192.168.10.101`. In the co-located
> alternative (Caddy as a Docker container on the Docker host) it would be `192.168.10.100`.
> FlytDokk has no dedicated setting for this yet, and PLAN.md is currently inconsistent
> (topology says Caddy is on `.101`, but the wildcard example reads `→ .100`). This must be
> pinned to one configured value before the module is built — see PLAN.md Module 3.

Because the wildcard `*.example.no → <caddy-ip>` already resolves *every* subdomain to
Caddy, the per-name rewrites FlytDokk adds are **cosmetic** — they make the routed set
visible and tidy in AdGuard, but the wildcard is what actually makes names work. This is
why the AdGuard step of an assign is always best-effort and never blocks a route.

---

## Endpoints

### 1. Health / reachability

```
GET /control/status
```

Returns `{ running, version, protection_enabled, dns_addresses, dns_port, http_port, … }`.
A 200 with `running: true` is FlytDokk's "AdGuard reachable" signal. No rewrite data here —
the wildcard check (below) is a separate call.

### 2. List rewrites

```
GET /control/rewrite/list
```

Returns the full `RewriteEntry[]`. FlytDokk uses this for three things: rendering the
rewrite list, the wildcard check, and the read-only sync comparison against instances.

### 3. Add a rewrite

```
POST /control/rewrite/add
Content-Type: application/json

{ "domain": "grafana.example.no", "answer": "192.168.10.101" }
```

Used by the assign flow (Step 2). `answer` is the constant Caddy IP, not the instance
upstream. Re-adding an identical entry is harmless.

### 4. Delete a rewrite

```
POST /control/rewrite/delete
Content-Type: application/json

{ "domain": "grafana.example.no", "answer": "192.168.10.101" }
```

Note the verb: AdGuard deletes via **POST** to `/rewrite/delete`, and the body is the
whole `(domain, answer)` entry — there is no delete-by-domain. FlytDokk reconstructs the
pair from the instance (subdomain → domain) plus the constant Caddy IP (→ answer). Used
when a subdomain is cleared or an instance is deleted.

### 5. Edit a rewrite — delete-then-add

Editing (e.g. a subdomain rename) is **delete-then-add**, not an in-place update:

```
POST /control/rewrite/delete   { old domain, answer }   # ignore failure — may not exist
POST /control/rewrite/add      { new domain, answer }
```

AdGuard *does* offer `PUT /control/rewrite/update` (`{ target, update }` pair), but
FlytDokk does not use it: delete-then-add is a single convergent code path that reuses the
same add call as everything else, mirrors the Caddy module's editing model, and is
idempotent. Because `answer` is constant, an edit is really just swapping the `domain`.
The brief gap while the old rewrite is absent is irrelevant — the wildcard covers the name
throughout.

### 6. Wildcard check

Not a dedicated endpoint — it is `GET /control/rewrite/list` (endpoint #2) filtered for an
entry whose `domain` is `*.{BASE_DOMAIN}` and whose `answer` is the Caddy IP. Surfaced
prominently in the UI, because everything depends on it: if the wildcard is missing, no
routed name resolves (regardless of per-name rewrites). FlytDokk only *reports* a missing
wildcard with a warning — creating it is a one-time setup step, not something the module
silently asserts.

### 7. Sync with the instance list — read-only

FlytDokk pulls `GET /control/rewrite/list` and, for each instance that has a subdomain,
checks whether a matching `(domain, answer)` rewrite is present. Present = in sync;
missing = cosmetic gap (the wildcard still covers it). This is a **display-only
comparison** — it never auto-corrects, matching the Caddy module's synced-status behavior.
"Push all" (best-effort) is the manual way to re-add any missing per-name rewrites.

---

## Ownership — what FlytDokk manages

FlytDokk manages only the per-name rewrites that correspond to its instances (one
`(subdomain.{BASE_DOMAIN}, caddy-ip)` entry per routed instance). It treats everything else
in AdGuard as not-its-business:

- The **wildcard** rewrite is infrastructure — FlytDokk checks it and warns if absent, but
  does not create or delete it.
- Any **hand-added** rewrite whose domain matches no instance is left untouched.

Because the wildcard already resolves every subdomain, the whole per-name set is a
convenience layer; losing it degrades tidiness, never reachability.

---

## Not used

For clarity, the large majority of the AdGuard Home API that FlytDokk deliberately does
**not** call — AdGuard's own UI owns all of it:

- `PUT /control/rewrite/update` — editing is delete-then-add (endpoint #5), so unused.
- `GET|PUT /control/rewrite/settings` — global "rewrites enabled" toggle; FlytDokk assumes
  rewrites are on and does not flip it.
- `/control/login`, `/control/logout` — Basic Auth is per-request; no session flow.
- Filtering (`/control/filtering/*`), blocked services, safebrowsing, parental, safesearch
  — blocklist/rule management stays in AdGuard's UI.
- Query log (`/control/querylog*`) and statistics (`/control/stats*`) — AdGuard's UI.
- Clients / access (`/control/clients/*`, `/control/access/*`) — AdGuard's UI.
- DHCP (`/control/dhcp/*`), TLS (`/control/tls/*`), DNS config (`/control/dns_config`,
  `/control/dns_info`), upstream testing — infrastructure, out of scope.
- Install wizard (`/control/install/*`) — AdGuard is already installed; FlytDokk never
  runs first-time setup.
