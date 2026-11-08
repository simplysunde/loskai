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
LABEL org.opencontainers.image.source=https://github.com/simplysunde/loskai
COPY Caddyfile /etc/caddy/Caddyfile
COPY setup/ /srv/setup/
# The image's own command plus --resume, as the Caddy LXC runs: Caddy saves its config after
# every change Loskai makes (in /config, a volume), and on start reloads that save — so the
# routes survive a restart. Only when there is no save yet does it start from the Caddyfile;
# a changed Caddyfile or BASE_DOMAIN takes effect once the save is removed
# (docs/guides/deployment.md).
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile", "--resume"]
