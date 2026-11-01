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
- **It holds an SSH key to the machines you give it** (once its public key is on them).
  The key is stored encrypted with the admin password and is usable for 15 minutes after
  you type that password — logging out locks it sooner. It works only from the Docker host
  when its IP is set — the line Loskai gives you starts with `from=` (on the Docker host
  itself, also from Loskai's own Docker networks). Give Loskai's login
  user on each machine only the `sudo` you want it to have.
- **A second, status-only key** is kept unencrypted, so each machine's running list and
  overview work without your password. The machine itself limits it to one command that
  only reads — what runs, and the system, memory, disks, updates waiting, tools and tmux
  session names — with no shell, no forwarding, only from the Docker host. A copy reveals
  that and nothing else.
- **The Machines tab opens a shell on a machine**, from the browser, as Loskai's SSH user —
  only while the key is unlocked, and only from Loskai's own pages. Each terminal opened,
  closed or refused is logged (when, which machine, from where), not what is typed in it.
- **Loskai holds no Claude or Tailscale login** — each is logged in on the machine, in its
  terminal.
- **Tools run fixed commands** that ship in the image — the browser only names one, and
  a value from the page (a service's name) reaches the command as an argument, never as
  code. They run as the SSH user in a terminal you see; anything needing root asks for
  `sudo` there. Each run is logged with its command.
- **Install it for me** sends a machine's password to that machine once, to add Loskai's
  keys, and keeps it nowhere. It is sent only after you have accepted the machine's host
  key, and a machine whose host key changes is refused.
- **Deleting a machine takes Loskai's key off it** — its two `authorized_keys` lines, and
  nothing else — before Loskai forgets it. A machine that can't be reached then is deleted
  anyway, and Loskai says its lines are still there to remove by hand.
- **A recipe runs the images it names.** Recipes are data, never executed themselves, but
  installing one starts its containers — trust a recipe source as you would its images.

## How access is controlled

- **One admin password**, stored only as an Argon2 hash. A login sets an `HttpOnly`,
  `SameSite=Lax` session cookie that lasts 7 days. **Log out ends every session**, on every
  device — a copied cookie stops working too, and an open terminal closes within seconds.
  After 5 wrong passwords, each one costs a wait that doubles up to a minute: a guesser gets
  about one try a minute.
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

- **No HTTPS of its own.** Port `:8080` is plain HTTP. Reach Loskai through its routed name
  (`https://loskai.<your domain>`) — a login there gets a `Secure` cookie, never sent in
  the clear — and don't open `:8080` beyond the machines you manage it from.
- **One login limit for everyone.** Someone on your network who keeps guessing keeps you
  out too, until they stop or Loskai restarts.
- **No user accounts or roles** — whoever has the password has everything above.

## Reporting a vulnerability

Report it privately through the repository's **Security → Report a vulnerability** form,
not a public issue. Only the latest `main` is supported.
