# Caddy as a container — layouts B and C (compose.caddy-loskai.yml, compose.colocated.yml).
#
# Stock Caddy with its internal CA (local_certs in the Caddyfile) — no plugin, no build
# arguments, nothing to configure. The onboarding page is baked in at /srv/setup so Caddy can
# serve it on :80.
#
# Public ACME certs (DNS-01) were supported here until 2026-09-27 and removed deliberately —
# see docs/project/HISTORY.md. Loskai only inserts routes by `@id` and never writes this Caddyfile, so
# swapping `local_certs` for a `tls { dns <provider> … }` block and rebuilding with the
# matching caddy-dns plugin is entirely a Caddy concern that Loskai will not notice.

FROM caddy:2
COPY Caddyfile /etc/caddy/Caddyfile
COPY setup/ /srv/setup/
