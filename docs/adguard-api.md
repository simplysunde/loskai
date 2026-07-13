# AdGuard Home REST API — Endpoints Loskai Uses

Loskai talks to AdGuard Home through its
[REST API](https://github.com/AdguardTeam/AdGuardHome/blob/master/openapi/openapi.yaml)
(the same API its own web UI is built on). All paths are under the `/control` base
(so `ADGUARD_URL` = `http://192.168.10.101:3000`, and a call to "rewrite list" is
`GET http://192.168.10.101:3000/control/rewrite/list`).

Loskai is a **thin companion** to AdGuard, not a replacement for its UI. It touches
exactly one feature area — **DNS rewrites** — plus a status probe. Everything else
(query logs, blocklists, clients, DHCP, TLS, upstreams) is left to AdGuard's own UI,
which Loskai links out to. This document is the contract: the subset we call, and why.

---

## Authentication

The API's security scheme is HTTP **Basic Auth** (`basicAuth`, applied globally). Every
request carries `Authorization: Basic <base64(user:password)>` from `ADGUARD_USER` /
`ADGUARD_PASSWORD`. There is a cookie-based `POST /control/login` flow as well, but Basic
Auth is per-request and stateless — no session to establish or refresh — so that is what
Loskai uses.

---

## Data model recap

A DNS rewrite in AdGuard is a flat object (`RewriteEntry`):

```json
{ "domain": "grafana.example.no", "answer": "192.168.10.101", "enabled": true }
```

- **`domain`** — the name to intercept. Supports wildcards (`*.example.no`).
- **`answer`** — the A/AAAA/CNAME value the name resolves to.
- **`enabled`** — optional; omitted on add defaults to `true`. Loskai always omits it.

Two things follow from this that shape the whole module:

**1. A rewrite has no ID — its identity is the `(domain, answer)` pair.** There is no
handle to address one by. `POST /control/rewrite/delete` takes the *full entry back*, not
a key. So to delete a rewrite Loskai must reproduce both fields exactly.

**2. `answer` is one shared value across all rewrites: the reverse-proxy (Caddy) IP.** DNS
only resolves a *name to an address* — it does not know about ports. The `answer` is
consumed by **LAN clients** (a browser resolving `grafana.example.no`), not by AdGuard
itself — AdGuard never connects to Caddy. So every routed name must resolve to the one IP
where Caddy listens for `:443`; the client then connects there and Caddy reverse-proxies
to each instance's real `host:port` upstream. The rewrite's `answer` is therefore **not**
the instance's upstream — it is the same Caddy LAN IP for every rewrite. Because it is
served to other machines it must be a **LAN IP, never `localhost`/`127.0.0.1`**, even when
AdGuard and Caddy are co-located on one box.

**Where the answer IP comes from:** it is derived from the host of `CADDY_ADMIN_URL`
(`http://192.168.10.101:2019` → `192.168.10.101`) — the Caddy admin host *is* the Caddy
host, so no separate setting is needed for the normal (LAN) deployment. The one exception
is the Docker co-located mode where `CADDY_ADMIN_URL` is a hostname (`http://caddy:2019`):
a hostname yields no client-usable LAN IP, so that case falls back to an explicit setting.

**There is no wildcard DNS rewrite.** Loskai creates **one explicit rewrite per routed
instance** and nothing catch-all. A name you have not assigned simply does not resolve
locally — it falls through to public DNS. This is deliberate: a `*.example.no` rewrite
would shadow the entire subdomain space locally and could hijack a real public name (say
`mail.example.no`) that happens to share the base domain. Explicit per-name rewrites are
surgical and mirror the Caddy module, which already routes every instance as a specific
host. (Separately, Caddy still uses a wildcard *TLS certificate* to get valid HTTPS for
local-only names — that is a cert concern in Caddy's own config, unrelated to DNS
rewrites, and Loskai does not touch it.)

Consequently each per-name rewrite is **load-bearing**, not cosmetic: without it the name
does not resolve locally. The AdGuard step of an assign is still best-effort in that a DNS
failure never rolls back the Caddy route — but the warning is meaningful ("name won't
resolve until the rewrite is added; retry when AdGuard is reachable"), not "the wildcard
covers it."

---

## Endpoints

### 1. Health / reachability

```
GET /control/status
```

Returns `{ running, version, protection_enabled, dns_addresses, dns_port, http_port, … }`.
A 200 with `running: true` is Loskai's "AdGuard reachable" signal. No rewrite data here —
the rewrite list (below) is a separate call.

### 2. List rewrites

```
GET /control/rewrite/list
```

Returns the full `RewriteEntry[]`. Loskai uses this for two things: rendering the
rewrite list, and the read-only sync comparison against instances (endpoint #7).

### 3. Add a rewrite

```
POST /control/rewrite/add
Content-Type: application/json

{ "domain": "grafana.example.no", "answer": "192.168.10.101" }
```

Used by the assign flow (Step 2). `answer` is the shared Caddy IP, not the instance
upstream. Re-adding an identical entry is harmless.

### 4. Delete a rewrite

```
POST /control/rewrite/delete
Content-Type: application/json

{ "domain": "grafana.example.no", "answer": "192.168.10.101" }
```

Note the verb: AdGuard deletes via **POST** to `/rewrite/delete`, and the body is the
whole `(domain, answer)` entry — there is no delete-by-domain. Loskai sends the **exact
pair** it created: the instance's domain plus the current Caddy IP. Used when a subdomain
is cleared or an instance is deleted.

Deleting the *exact pair* (not just the domain) is a deliberate safety choice: if a
rewrite exists for the same domain but points somewhere else — e.g. one you added by
hand — it does not match and is left untouched.

To also clean up entries left behind when the Caddy IP changes, each instance records the
answer Loskai last wrote for it in its `dns_answer` field (see
[Reconcile](#6-sync--reconcile-with-the-instance-list)). A delete/reconcile removes the
`(domain, dns_answer)` pair actually on record — so an old-generation orphan (from a
previous IP) is removed, while an entry whose answer Loskai never wrote is never matched.
That recorded answer is what separates "our stale entry" (safe to delete) from "a manual
entry on the same domain" (leave, warn).

### 5. Edit a rewrite — delete-then-add

Editing (e.g. a subdomain rename) is **delete-then-add**, not an in-place update:

```
POST /control/rewrite/delete   { old domain, answer }   # ignore failure — may not exist
POST /control/rewrite/add      { new domain, answer }
```

AdGuard *does* offer `PUT /control/rewrite/update` (`{ target, update }` pair), but
Loskai does not use it: delete-then-add is a single convergent code path that reuses the
same add call as everything else, mirrors the Caddy module's editing model, and is
idempotent. Because `answer` is constant, an edit is really just swapping the `domain`.
The brief gap between delete and add is irrelevant — it is a config change the user just
initiated, and it only affects the name being renamed.

### 6. Sync / reconcile with the instance list

**Read-only status** (the default view): Loskai pulls `GET /control/rewrite/list` and,
for each instance that has a subdomain, checks whether a matching `(domain, currentIP)`
rewrite is present. Present = in sync; missing = the name does not resolve locally until
the rewrite is added. This is a **display-only comparison** — it never auto-corrects,
matching the Caddy module's synced-status behavior.

**Reconcile** (the explicit "Push all" action, or when a Caddy-IP change is detected on
startup): for each routed instance Loskai ensures `(domain, currentIP)` exists and, if the
instance's stored `dns_answer` differs from `currentIP`, deletes the stale
`(domain, dns_answer)` pair — migrating the entry onto the current IP — then updates
`dns_answer`. It writes `dns_answer` whenever it adds a rewrite. A same-domain entry whose
answer matches **neither** `currentIP` **nor** the instance's stored `dns_answer` is a
manual rewrite: reconcile leaves it and reports a conflict, never overwrites it. Reconcile
is best-effort and only ever touches answers Loskai itself wrote.

---

## Ownership — what Loskai manages

Loskai manages only the exact `(subdomain.{BASE_DOMAIN}, caddy-ip)` entries that
correspond to its instances — one per routed instance. It **never** touches anything else
in AdGuard's rewrite list, because every write is a single add or an exact-pair delete
(the API has no bulk/replace):

- A **hand-added** rewrite for a different domain is invisible to Loskai.
- A **hand-added** rewrite for the *same* domain as an instance, whose answer matches
  neither the current Caddy IP nor the instance's stored `dns_answer`, is treated as manual:
  reconcile leaves it in place and **surfaces a conflict warning** (AdGuard would otherwise
  hold two answers for that name and resolve ambiguously), rather than overwriting or
  deleting it. Only answers Loskai has itself written are ever removed.

There is no wildcard rewrite to own or assert — the managed set is exactly one entry per
routed instance, and it is load-bearing: it is what makes local names resolve.

---

## Not used

For clarity, the large majority of the AdGuard Home API that Loskai deliberately does
**not** call — AdGuard's own UI owns all of it:

- `PUT /control/rewrite/update` — editing is delete-then-add (endpoint #5), so unused.
- `GET|PUT /control/rewrite/settings` — global "rewrites enabled" toggle; Loskai assumes
  rewrites are on and does not flip it.
- `/control/login`, `/control/logout` — Basic Auth is per-request; no session flow.
- Filtering (`/control/filtering/*`), blocked services, safebrowsing, parental, safesearch
  — blocklist/rule management stays in AdGuard's UI.
- Query log (`/control/querylog*`) and statistics (`/control/stats*`) — AdGuard's UI.
- Clients / access (`/control/clients/*`, `/control/access/*`) — AdGuard's UI.
- DHCP (`/control/dhcp/*`), TLS (`/control/tls/*`), DNS config (`/control/dns_config`,
  `/control/dns_info`), upstream testing — infrastructure, out of scope.
- Install wizard (`/control/install/*`) — AdGuard is already installed; Loskai never
  runs first-time setup.
