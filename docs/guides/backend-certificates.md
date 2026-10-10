[Docs](../README.md) › [Guides](../README.md#guides)

# Trusting a backend's own certificate (Proxmox and friends)

**Read this when** you open a backend on its own port (Proxmox `:8006`, a NAS UI) and want
no warning there either.

Some services insist on serving their own HTTPS: Proxmox on `:8006`, a NAS admin UI, an
IPMI board. Loskai proxies those happily — tick **Backend speaks HTTPS** when you assign the
route and Caddy dials them over TLS without verifying their self-signed certificate. That is
the normal path and nothing here replaces it.

This page is about the *other* case: when you also want to open `https://192.168.10.x:8006`
**directly**, bypassing the proxy, without a browser warning. The answer is to give that
backend a certificate signed by the same internal root your devices already trust — which
Caddy can do, because it can act as an ACME server for its own CA.

> **Read [certificate-setup.md](certificate-setup.md) first.** That page is about teaching
> *devices* to trust Caddy. This one is about teaching a *backend* to serve something they
> already trust. They solve different halves of the same problem.

---

## When this is worth doing

| | Proxy it (default) | Certificate it (this page) |
|---|---|---|
| Effort | one route in Loskai | ACME client on the backend, plus the setup below |
| Works for | anything, including devices that can run nothing | only backends with an ACME client |
| Reaching it on its own port | still warns | trusted |
| Loskai involvement | route + rewrite | none — this is entirely Caddy and the backend |

Do it for the handful of machines you genuinely open on their own port. Proxying stays
simpler for everything else, and the two are **mutually exclusive per name** — see the trap
below.

---

## The trap: one name cannot be both

A name resolves to exactly one address. If `proxmox.{BASE_DOMAIN}` is a proxied route, your
AdGuard rewrite points it at **Caddy**. When the ACME server then validates a challenge for
that name, it connects to the name — and reaches itself, not Proxmox. Validation fails, and
neither end says why in a way that helps.

**So pick one per name.** The tidy arrangement is to *stop proxying* the backend and make it
a **machine** in Loskai instead (Machines → **Name a machine**): `dns_only`, resolving straight
to the backend's IP. Your browser then goes direct, with a certificate it trusts, and nothing
is in the path. That is what machines are for.

If you want both, use two names. That is also the answer to *"then how does Proxmox appear
on the dashboard?"* — **machines never do**, because an address has no port to link to. Give
it a route under a second name and that route is the card:

| | name | what it is |
|---|---|---|
| direct, certified | `proxmox.{BASE_DOMAIN}` | a **machine** → `192.168.10.177`. Not on the dashboard. |
| launcher entry | `pve.{BASE_DOMAIN}` | a **route** → `192.168.10.177:8006`, **Backend speaks HTTPS** ticked. Appears as a card. |

Build the second one with Add route → **External** → pick the machine from the list: it fills
the address, you add `:8006`. That also *links* the route to the machine, so if the host ever
moves, the route follows it.

---

## 1. Turn Caddy into an ACME server

Add a site to Caddy's Caddyfile (`caddy/Caddyfile`, or `/etc/caddy/Caddyfile` on the LXC).
It signs with the **same internal CA** that already signs your routes, so anything trusting
your root automatically trusts what it issues:

```caddyfile
{
	pki {
		ca local {
			# Leaves cannot outlive the intermediate that signed them. The default is 7d,
			# which is too short once the leaf lifetime below is measured in days.
			intermediate_lifetime 30d
		}
	}
}

acme.{$BASE_DOMAIN} {
	acme_server {
		ca local
		# 12h is the default and it does not survive a daily renewal timer — see below.
		lifetime 168h
	}
}
```

The ACME directory clients point at is then:

```
https://acme.<your-base-domain>/acme/local/directory
```

**`lifetime` is the setting that decides whether this works at all.** Caddy issues 12-hour
certificates by default. Proxmox renews from a **daily** timer, and only when the certificate
expires within 30 days — so a 12-hour leaf is expired for most of each day. A week (`168h`)
leaves plenty of room. Raising it means raising `intermediate_lifetime` too: the leaf must
expire before its signing intermediate, and Caddy answers a request that violates that with a
`500`, not a helpful message.

`acme_server` also takes `allow`/`deny` blocks (by `domains` and `ip_ranges`) if you want to
restrict which names it will issue for. Worth it if the LAN has guests on it.

---

## 2. Teach the backend to trust your root

The backend's ACME client talks to the ACME server **over HTTPS**, so it has to trust your
internal root before it can do anything. On a Debian-based host such as Proxmox:

```bash
curl -fsSL http://<caddy-ip>/caddy-root.crt \
  -o /usr/local/share/ca-certificates/caddy-root.crt
update-ca-certificates
```

(Or download it from Loskai's **Certificate** page and copy it across.) Skip this and the
first certificate order fails on an untrusted TLS connection to your own ACME server.

**It also has to resolve `acme.{BASE_DOMAIN}`**, which means using AdGuard as its resolver.
Proxmox nodes are often configured with an upstream DNS directly, in which case they never see
your rewrites — check `/etc/resolv.conf` on the node before blaming the certificate.

---

## 3. Point Proxmox at it

Verified against the Proxmox VE documentation; the GUI path is **Datacenter → ACME** for the
account, then **Node → Certificates** for the domain.

```bash
# 1. Register an account against your own directory.
#    Choose "2) Custom" when prompted, then give the directory URL from step 1.
pvenode acme account register loskai you@example.com

# 2. Tell the node which name it should hold a certificate for.
pvenode config set --acme domains=proxmox.<your-base-domain>

# 3. Order it.
pvenode acme cert order
```

Proxmox supports **http-01** (a standalone listener it starts on `:80` during validation) and
**dns-01** (via acme.sh-compatible plugins). http-01 is the simpler choice on a LAN — but it
is exactly the case the trap above breaks, so make sure the name resolves to the *Proxmox
host* and not to Caddy.

Renewal is automatic from `pve-daily-update.service`, which renews a certificate that has
expired or will expire within 30 days. With the `168h` lifetime above, that is comfortable.
The Proxmox documentation notes that for short-lived certificates you may want to disable the
random delay on `pve-daily-update.timer` — another reason not to leave `lifetime` at 12h.

---

## What Loskai does about any of this

**Nothing, deliberately.** Loskai never handles certificate material: it inserts routes by
`@id` through Caddy's Admin API and reads the root CA for the Certificate page. It has no
ACME code, no awareness of how a backend got its certificate, and no opinion about it.

Two consequences worth knowing:

- **You can do all of this without telling Loskai.** Adding an `acme_server` site to the
  Caddyfile does not disturb Loskai's routes, and `Sync` will not remove it — `push_all` only
  touches routes whose `@id` matches an instance, and Caddyfile-derived sites have no `@id`.
- **Once a backend is trusted directly, `upstream_tls` is still fine.** Caddy's own leg to the
  backend keeps skipping verification. Making it verify would need per-instance CA pinning,
  which was considered and rejected: it buys little against an attacker who is already inside
  the LAN. See [caddy-api.md](../reference/caddy-api.md).

---

## If it does not work

| Symptom | Likely cause |
|---|---|
| Order fails, TLS error reaching the directory | The backend does not trust your root yet — step 2. |
| Order fails, cannot resolve `acme.<domain>` | The backend is not using AdGuard for DNS. |
| Validation fails or certifies the wrong host | The name resolves to Caddy, not the backend — the trap above. |
| Certificate expires between renewals | `lifetime` left at the 12h default. |
| Caddy returns `500` on an order | Leaf `lifetime` exceeds what `intermediate_lifetime` allows. |
| Browser still warns after a successful order | The *browser's* device has not installed the root — [certificate-setup.md](certificate-setup.md). |
