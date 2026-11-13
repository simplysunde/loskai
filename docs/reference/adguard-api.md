[Docs](../README.md) › [Reference](../README.md#reference)

# AdGuard Home REST API — Endpoints Loskai Uses

**Read this when** you are changing how Loskai talks to AdGuard.

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

The API's security scheme is HTTP **Basic Auth** (`basicAuth`, applied globally). When
`ADGUARD_USER` is set, every request carries `Authorization: Basic <base64(user:password)>`
from `ADGUARD_USER` / `ADGUARD_PASSWORD`; without it, none is sent. There is a
cookie-based `POST /control/login` flow as well, but Basic Auth is per-request and
stateless — no session to establish or refresh — so that is what Loskai uses.

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

**2. `answer` depends on the instance's `route_mode`.** For a `proxy` instance (the
default — a Caddy-routed HTTP(S) service), `answer` is one shared value across *all* proxy
rewrites: the reverse-proxy (Caddy) IP. DNS only resolves a *name to an address* — it does
not know about ports. The `answer` is consumed by **LAN clients** (a browser resolving
`grafana.example.no`), not by AdGuard itself — AdGuard never connects to Caddy. So every
proxy-routed name must resolve to the one IP where Caddy listens for `:443`; the client
then connects there and Caddy reverse-proxies to each instance's real `host:port` upstream.
The rewrite's `answer` is therefore **not** the instance's upstream — it is the same Caddy
LAN IP for every proxy rewrite. Because it is served to other machines it must be a
**LAN IP, never `localhost`/`127.0.0.1`**, even when AdGuard and Caddy are co-located on
one box.

For a **`dns_only`** instance (no Caddy involved — see the architecture's
["Machines"](../project/architecture.md#machines)), there is
no reverse proxy to point at: `answer` is that instance's own `upstream`, which is itself a
bare IP (not `host:port`). Each `dns_only` instance can have a *different* answer — the
"one shared value" rule above only ever applied to proxy instances.

**Where the proxy answer IP comes from:** `CADDY_HOST_IP` when it is set; otherwise the
host of `CADDY_ADMIN_URL`, when that host is an IP (`http://192.168.10.101:2019` →
`192.168.10.101`) — the Caddy admin host *is* the Caddy host, so no separate setting is
needed for the normal (LAN) deployment. A hostname (`http://caddy:2019`, the Docker
co-located mode) yields no client-usable LAN IP, so there `CADDY_HOST_IP` must be set. A
loopback or `0.0.0.0` address, from either source, counts as unset. None of this applies
to `dns_only` instances, which need no `CADDY_HOST_IP` at all — a LAN made entirely of
`dns_only` names can leave it unset.

**There is no wildcard DNS rewrite.** Loskai creates **one explicit rewrite per routed
instance** and nothing catch-all. A name you have not assigned simply does not resolve
locally — it falls through to public DNS. This is deliberate: a `*.example.no` rewrite
would shadow the entire subdomain space locally and could hijack a real public name (say
`mail.example.no`) that happens to share the base domain. Explicit per-name rewrites are
surgical and mirror the Caddy module, which already routes every instance as a specific
host. (Separately, Caddy's internal CA issues the *TLS certificates* for HTTPS on local-only
names — one per routed name — a cert concern in Caddy's own config, unrelated to DNS
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
A 200 is Loskai's "AdGuard reachable" signal: `healthy`, or `degraded` when it says
`running: false` (a missing `running` counts as true). No rewrite data here —
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

Used by the assign flow (Step 2). `answer` is the shared Caddy IP for a `proxy` instance,
or that instance's own `upstream` for `dns_only`. **Re-adding an identical entry keeps a
second copy** (v0.107.80, seen 2026-11-13), so the assign lists the rewrites first and adds
only a pair that isn't there — a save that changes neither half adds nothing.

### 4. Delete a rewrite

```
POST /control/rewrite/delete
Content-Type: application/json

{ "domain": "grafana.example.no", "answer": "192.168.10.101" }
```

Note the verb: AdGuard deletes via **POST** to `/rewrite/delete`, and the body is the
whole `(domain, answer)` entry — there is no delete-by-domain. Loskai sends the **exact
pair** it wrote: the instance's domain plus the answer on record in its `dns_answer`
(below), not the current Caddy IP. Used when a subdomain is cleared or an instance is
deleted.

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

Editing (a subdomain rename, or a `dns_only` instance's own answer changing — a mode
switch, or just repointing it to a new IP) is **delete-then-add**, not an in-place update:

```
POST /control/rewrite/delete   { old domain, old answer }   # ignore failure — may not exist
POST /control/rewrite/add      { new domain, new answer }
```

AdGuard *does* offer `PUT /control/rewrite/update` (`{ target, update }` pair), but
Loskai does not use it: delete-then-add is a single convergent code path that reuses the
same add call as everything else, mirrors the Caddy module's editing model, and is
idempotent. The delete only fires when the *pair* is actually about to change — a rename
(domain differs), a `proxy`↔`dns_only` mode switch or an in-place IP change for `dns_only`
(same domain, answer differs), or both at once. Skip it (add is a no-op re-add) when
neither half changed. Getting this condition right matters: rewrites are keyed by the
`(domain, answer)` pair, not an ID, so missing a case where the answer changed — as
opposed to only checking the domain — leaves the old pair behind, and the domain now
resolves to two different IPs until the next Sync. The brief gap between delete and add
is irrelevant — it is a config change the user just initiated, and it only affects the
name being edited.

### 6. Sync / reconcile with the instance list

**Read-only status** (the default view): Loskai pulls `GET /control/rewrite/list` and,
for each instance that has a subdomain, checks whether a matching `(domain, target)`
rewrite is present — `target` being the shared Caddy IP (`currentIP`) for `proxy`, the
instance's own address for `dns_only` (`target_answer`). Present = in sync; missing = the
name does not resolve locally until the rewrite is added. This is a **display-only
comparison** — it never auto-corrects, matching the Caddy module's synced-status behavior.

**Reconcile** (the explicit **Sync** action — nothing runs it on its own, not even at
startup): for each routed instance Loskai ensures `(domain, target)` exists and, if the
instance's stored `dns_answer` differs from `target`, deletes the stale
`(domain, dns_answer)` pair — migrating the entry onto the current answer — then updates
`dns_answer`. It writes `dns_answer` whenever it adds a rewrite. A same-domain entry whose
answer matches **neither** `target` **nor** the instance's stored `dns_answer` is a
manual rewrite: reconcile leaves it and reports a conflict, never overwrites it.

**Orphan sweep** (part of reconcile): a rewrite that sits in the `{BASE_DOMAIN}` namespace
and is owned by **no** routed instance is a Loskai leftover — typically from a
remove/delete whose best-effort DNS delete failed while AdGuard was down — *if* its answer
is one Loskai is known to have written: either the shared `currentIP` (proxy instances), or
any currently-routed instance's own `dns_answer` (covers `dns_only` leftovers too, since
those don't share one IP). Reconcile deletes these. Reported as `swept`.

The domain-shape check used to require a *single* label (`<label>.{BASE_DOMAIN}`), which
alone guaranteed a multi-label name was never Loskai's. Since `dns_only` instances can now
have dot-separated names (`rack1.vm3.{BASE_DOMAIN}`), that shape check was relaxed to any
non-empty label(s) under `{BASE_DOMAIN}` — so the **answer-match check above is now the
sole safety net** against sweeping a hand-added rewrite. This is a deliberate, slightly
wider blast radius than before: the residual risk is a hand-added rewrite that happens to
share both a `{BASE_DOMAIN}`-suffixed name *and* the exact IP of some other live instance —
narrow, but no longer impossible the way it was under the old single-label-only rule.

Reconcile is best-effort and only ever touches answers Loskai itself wrote.

---

## Ownership — what Loskai manages

Loskai manages only the exact `(subdomain.{BASE_DOMAIN}, target)` entries — the Caddy IP,
or a `dns_only` instance's own address — that correspond to its instances, one per routed
instance. It **never** touches anything else in AdGuard's rewrite list, because every
write is a single add or an exact-pair delete (the API has no bulk/replace):

- A **hand-added** rewrite for a different domain is invisible to Loskai.
- A **hand-added** rewrite for the *same* domain as an instance, whose answer matches
  neither its target nor the instance's stored `dns_answer`, is treated as manual:
  reconcile leaves it in place and **surfaces a conflict warning** (AdGuard would otherwise
  hold two answers for that name and resolve ambiguously), rather than overwriting or
  deleting it. Only answers Loskai has itself written are ever removed.

There is no wildcard rewrite to own or assert — the managed set is exactly one entry per
routed instance, and it is load-bearing: it is what makes local names resolve.

**The one exception is the explicit reset** (`POST /api/adguard/rewrites/clear`, Settings ›
Network › AdGuard). It deletes every rewrite in the list — hand-added ones included — and
then reconciles Loskai's own back. It exists so an AdGuard that already carries rewrites
(from before Loskai, or under a previous `BASE_DOMAIN`, which the orphan sweep cannot see
because `is_loskai_domain` scopes it to the *current* base domain) can be adopted wholesale
instead of cleaned by hand. It changes nothing above: each delete still names its exact
`(domain, answer)` pair, and no automatic path — assign, teardown, reconcile, the sweep —
ever touches a foreign entry. What it adds is a deliberate, confirmed, user-initiated
action — and the dialog lists every entry first, marking which ones the restore brings
back (`GET /api/adguard/rewrites`), so "every rewrite" is checkable instead of taken on
trust.

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
