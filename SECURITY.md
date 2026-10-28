# Security

Loskai is a **LAN admin tool**: it controls Docker on its host and the DNS and routing for
your network. Read this before deciding where it runs and who can reach it.

## What it can do on your host

- **It holds the Docker socket**, which is root on the host in all but name: anything that
  controls the socket can start a privileged container. Loskai must be the only container
  with it mounted. The app itself runs as the owner of `./data`, not as root
  ([deployment.md](docs/guides/deployment.md#who-owns-the-files-loskai-writes)).
- **The Docker tab opens a root shell in any container**, from the browser.
- **It writes your Caddy routes and AdGuard DNS rewrites.** It deletes only the rewrites it
  made, matched by name *and* answer — except Settings › Network's confirmed "clear all".
- **A recipe runs the images it names.** Recipes are data, never executed themselves, but
  installing one starts its containers — trust a recipe source as you would its images.

## How access is controlled

- **One admin password**, stored only as an Argon2 hash. A login sets an `HttpOnly`,
  `SameSite=Lax` session cookie that lasts 7 days. **Log out ends every session**, on every
  device — a copied cookie stops working too.
- **The lock is on the API, never the page.** Every `/api/*` route needs the session except
  the dashboard, the login flow, the Caddy root certificate (public by design) and launcher
  icons. The terminal WebSocket checks the session itself.
- **Only Loskai's own pages can act.** Your other apps share Loskai's domain, so a browser
  sends them its cookie; a request that changes something, or opens the terminal, is refused
  unless it comes from Loskai's own address.
- **Secrets on disk** — `settings.json` (the AdGuard password), the session secret and every
  stack `.env` — are readable by their owner only.
- **Uploaded icons** are checked by their bytes, and SVG is refused.

## Known limits

- **No HTTPS of its own.** Port `:8080` is plain HTTP, and the session cookie is not marked
  `Secure`. Reach Loskai through its routed name (`https://loskai.<your domain>`), and don't
  open `:8080` beyond the machines you manage it from.
- **No login rate limit.** Use a long password, and never expose Loskai to the internet.
- **No user accounts or roles** — whoever has the password has everything above.

## Reporting a vulnerability

Report it privately through the repository's **Security → Report a vulnerability** form,
not a public issue. Only the latest `main` is supported.
