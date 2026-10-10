[Docs](../README.md) › [Guides](../README.md#guides)

# Certificate onboarding (internal-CA mode)

**Read this when** a browser warns about the certificate on a Loskai name.

Loskai's **default** TLS mode is Caddy's **internal CA** (`local_certs` / `tls internal`) —
Caddy signs every `*.BASE_DOMAIN` name with its own root, with no real domain or ACME/DNS
token required. Publicly trusted certs are a possible future alternative — see `TODO.md`'s
backlog — but Loskai ships no mode for them: it never writes the Caddyfile, so that choice is
made in Caddy's own config.

Teaching a *backend* to serve a certificate your devices already trust — Proxmox on `:8006`,
a NAS admin UI — is the mirror image of this page and lives in
[backend-certificates.md](backend-certificates.md).
Browsers don't trust that root, so LAN devices get a cert warning until they install it
**once**. Install the root on a device once and **every** `*.BASE_DOMAIN` name is trusted,
including ones you add later — one internal root signs all the per-name leaves.

There are **two ways to get the root**, and they exist for different reasons:

| | [Loskai's Certificate page](#loskais-certificate-page-primary) | [Caddy's `:80` site](#caddys-80-onboarding-site-fallback) |
|---|---|---|
| Reached at | `/certificate` on Loskai | `http://<caddy-ip>/` |
| Works when | always — any topology | Caddy shares a host you can reach on `:80` |
| Source of the root | Caddy's Admin API | Caddy's own data volume |
| If you ever move to publicly trusted certs | survives — says "nothing to install" | becomes pointless, and `:80` may be wanted for an HTTP-01 challenge |

Prefer the Certificate page. The `:80` site still ships because it works with Loskai
stopped, which is worth having on the day you're setting the machine up.

> Loskai handles no certificate **key** material and is not in the issuance path — that
> stays entirely with Caddy. It does now *serve* the root CA, which is public by
> definition (the whole point is that every device installs it). Unrelated to the
> deferred "Cert Status" (public-cert expiry) feature.

## Loskai's Certificate page (primary)

`/certificate` in the Loskai UI: a download button plus per-OS trust instructions. It is
**public, like the Dashboard** — a device that doesn't trust the internal CA yet can't be
asked to log in over the HTTPS route to fix exactly that, so reach Loskai directly at
`http://<host-ip>:8080/certificate` and hand that link to any new device.

The PEM comes from Caddy's Admin API (`GET /pki/ca/local` → Loskai's
[`GET /api/caddy/root-certificate`](../reference/api.md#caddy--apicaddy-read--push-only-never-assigns)),
so it works in **every** topology — including split-LXC, where Caddy's data volume is on
another machine entirely. The download is served by Loskai itself rather than linked to
Caddy's `:80` file, because a plain-HTTP download from an HTTPS page is blocked outright
by Chrome and Edge, and silently.

If Caddy isn't using an internal CA, the page says there's nothing to install rather than
erroring — a public-ACME deployment is already trusted.

### Hiding the tab

`CERTIFICATE_TAB` (or Settings → Network → Caddy) controls where the sidebar links it:
`public` (default), `admin` (only once logged in), or `hidden`. Set it to `hidden` once
you're on publicly trusted certs. This moves a **link**, not a lock: `/certificate` and
its download stay public in every mode, because the root CA is public material.

## Caddy's `:80` onboarding site (fallback)

A standalone page (`caddy/setup/index.html`) and the live root cert, served by a
**plain-HTTP site on `:80`** configured in Caddy's bootstrap Caddyfile — *not* pushed
through Loskai's API, and reachable with Loskai stopped. HTTP on purpose: the page's job
is to fix the untrusted-cert warning, so it can't sit behind that same untrusted cert.
Reach it **by IP** (no DNS or trust needed first).

> **It listens on the whole of `:80`, but no longer swallows your names.** The block starts
> with a matcher on `*.{$BASE_DOMAIN}` that redirects those to HTTPS, so typing
> `grafana.home.lan` with no scheme redirects as you would expect; the page itself answers
> everything else, which in practice means browsing to Caddy **by IP**. Keyed on the domain
> rather than this host's IP deliberately: Caddy is already given `BASE_DOMAIN`, and a
> bridged container cannot detect its own host IP.
>
> **This does not override a `scheme: "http"` route.** Loskai pushes those into this same
> `:80` server at index 0, ahead of everything in the Caddyfile, so they proxy normally
> — see [api.md](../reference/api.md) (`POST /api/routes`, `scheme`).
>
> When you move to public ACME, this block has to go — the HTTP-01 challenge needs `:80`.

```caddyfile
:80 {
	# Caddy's internal root CA, streamed live from its PKI (unique per install — never committed)
	handle /caddy-root.crt {
		root * /data/caddy/pki/authorities/local
		rewrite * /root.crt
		header Content-Type application/x-x509-ca-cert
		file_server
	}
	# Everything else → the onboarding page
	handle {
		root * /srv/setup
		file_server
	}
}
```

The setup dir is mounted read-only (`./caddy/setup:/srv/setup:ro`); the PKI path is already
inside Caddy's `/data` volume. The `/caddy-root.crt` file appears once Caddy has initialised
its `local` CA (on first internal-cert issuance — hit any HTTPS name once if it 404s).

### Separate server — why it's safe

The `:80` site is a **separate Caddy server** from the `:443` routing server. Loskai
discovers the routing server by its `:443` listener (`service.select_server_name`), so it
never pushes reverse-proxy routes into this static site, and the orphan sweep never touches
it (it has no `@id`).

## Reaching it

- **Dev:** <http://localhost:8081/> (compose maps `8081:80`).
- **Prod (Caddy LXC):** `http://<caddy-lxc-ip>/`.

  The shipped file already keeps your real names redirecting to HTTPS (see the note
  above). Scoping the whole site to the LXC IP is still an option if you would rather it
  answered nothing else at all:

  ```caddyfile
  http://192.168.10.100 {   # the Caddy LXC's IP
  	handle /caddy-root.crt { … }
  	handle { root * /srv/setup; file_server }
  }
  ```

## A friendly `setup.<domain>` name (optional, later)

By design this is **by-IP only** for now. A bare `setup.<BASE_DOMAIN>` → Caddy-IP rewrite
added straight into AdGuard would be reclaimed by Loskai's orphan sweep (a `<label>.<base>`
rewrite at the Caddy IP that no routed instance owns). If you want the friendly name, create
it as an ordinary **external instance** in Loskai with upstream `<caddy-ip>:80` — Caddy then
proxies to its own `:80` file server. Being an owned, routed instance, it's sweep-safe. It's
served over HTTPS, so first-timers still use the by-IP link; the name is a post-trust
convenience.

## The two pages say the same thing

The `:80` page is a static copy of Loskai's Certificate page — the same three steps, the
same per-OS tabs and wording, the same look — so a device sees one set of instructions
whichever it reached. Neither names anything domain-specific, so there is nothing to
customise. It is hand-kept in step: change `frontend/src/pages/Certificate.tsx`, change
`caddy/setup/index.html` too.

**Updating a running Caddy.** The co-located container bakes the page into its image, so
rebuild it. A Caddy LXC fetched it once at creation (`create-caddy-lxc.sh`); re-run that
fetch inside the LXC — `file_server` reads the file fresh, so no restart is needed:

```bash
curl -fsSL "$REPO_RAW_BASE/caddy/setup/index.html" -o /srv/setup/index.html
```

## Trust-store commands differ by distro

Worth knowing, since both pages carry these and one wrong command reads as "this doesn't
work": `update-ca-certificates` is a **Debian** tool and does not exist on Fedora, which
uses `/etc/pki/ca-trust/source/anchors/` + `update-ca-trust`. Separately, Chrome and
Chromium on Linux read their own NSS database rather than the system store, so a
system-wide install alone leaves the warning in place in the browser most people use.
Both pages now cover all of it.
