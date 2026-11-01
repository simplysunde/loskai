# Changelog

What changed for someone running Loskai, newest first. The reasons behind each change are
in [`HISTORY.md`](docs/project/HISTORY.md).

## Unreleased — first public release

Everything so far:

- **Routing** — give any service an HTTPS name in one step: Caddy route and AdGuard DNS
  entry together. Sources: a container, a network service (AdGuard, router, Caddy) or any
  IP and port. Per route: HTTPS, HTTP or both, and whether the backend speaks HTTPS.
- **Machines** — name the computers on your network; every route on a machine's address is
  listed under it (its row opens like a stack's) and moves with it when the address changes. A Docker route can follow its
  container the same way. Loskai makes
  its own SSH key, encrypted with your admin password, and keeps an SSH config of your
  machines — set a machine's SSH user and port in its form, download the file from
  Settings. Saving a machine with an SSH user sets SSH up: trust its host key, then type its
  password once and Loskai installs its key. Each machine then shows how much runs on it —
  containers, services, Proxmox guests — listed on hover — and opens a terminal in the
  browser. Every terminal session is logged.
- **Terminals** — Tab completes, Ctrl+Shift+C copies, Ctrl+V pastes. The container terminal
  now shows bash's prompt and error messages (it hid them before), and opens a shell in
  images without bash.
- **Docker** — containers grouped by stack, with start/stop, update, logs, a terminal,
  stack editing — a form for settings and folders, or the files as text — and unused-volume
  cleanup. Containers you already run are listed from the start, with a guide to bringing
  them in — installing the recipe over your existing data, where there is one.
- **Install wizard** — apps from recipe repos, with their own icons, routed on install.
  **Check for updates** shows which installed recipes have a newer version and what
  changes; Update replaces the recipe's `compose.yml` and keeps your settings and folders.
  Optional features a recipe offers — Jellyfin's hardware transcoding — are checkboxes, at
  install or later under Edit.
- **Dashboard** — every service as a launcher card, usable without logging in.
- **Certificate page** — installs Caddy's root certificate on each device, once.
- **Security** — one admin password; only Loskai's own pages can act with its session, not
  your other apps under the same domain; the app runs as the owner of its data folder, not
  root; secrets on disk are owner-only ([SECURITY.md](SECURITY.md)).
