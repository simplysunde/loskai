# Certificate onboarding (internal-CA mode)

When Caddy runs with its **internal CA** (`local_certs` / `tls internal`) instead of
public ACME certs, it signs every `*.BASE_DOMAIN` name with its own root. Browsers don't
trust that root, so LAN devices get a cert warning until they install it **once**. This
page is a small onboarding site — served by Caddy itself — that hands out the root and
walks a user through installing it (Windows / macOS / Linux / Firefox, auto-detected).

Install the root on a device once and **every** `*.BASE_DOMAIN` name is trusted, including
ones you add later — one internal root signs all the per-name leaves.

> Loskai handles **zero** certificate material. This is entirely a Caddy concern (the page
> is static files Caddy serves); Loskai is never in the path. Unrelated to the deferred
> "Cert Status" (public-cert expiry) feature.

## How it's served

The page (`caddy/setup/index.html`) and the live root cert are served by a **plain-HTTP
site on `:80`**, configured in Caddy's bootstrap Caddyfile — *not* pushed through Loskai's
API. HTTP on purpose: the page's job is to fix the untrusted-cert warning, so it can't sit
behind that same untrusted cert. Reach it **by IP** (no DNS or trust needed first).

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
- **Prod (LXC 101):** `http://<caddy-lxc-ip>/` — hand this URL to any new device once.

  In prod, scope the site to the LXC IP so it doesn't shadow the automatic HTTP→HTTPS
  redirects for your real names:

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

## Customising the page

The page's `home.lan` strings (title, footer, step text) are just the base-domain label —
edit `caddy/setup/index.html` to your domain, or leave them.
