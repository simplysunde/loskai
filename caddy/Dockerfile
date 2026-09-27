# Caddy for the co-located (all-in-Docker) setup.
#
# Default: stock Caddy with its internal CA (local_certs in the Caddyfile) — no plugin needed.
# The onboarding page is baked in at /srv/setup so Caddy can serve it on :80.

FROM caddy:2
COPY Caddyfile /etc/caddy/Caddyfile
COPY setup/ /srv/setup/

# --- Future: public ACME certs ------------------------------------------------------------
# To obtain a real wildcard *.BASE_DOMAIN cert via DNS challenge, build Caddy with the
# caddy-dns plugin for your DNS host (https://github.com/orgs/caddy-dns/repositories) and
# switch the Caddyfile to its commented ACME block. Replace the two lines above with:
#
# FROM caddy:2-builder AS builder
# ARG CADDY_DNS_PLUGIN=github.com/caddy-dns/cloudflare
# RUN xcaddy build --with ${CADDY_DNS_PLUGIN}
# FROM caddy:2
# COPY --from=builder /usr/bin/caddy /usr/bin/caddy
# COPY Caddyfile /etc/caddy/Caddyfile
# COPY setup/ /srv/setup/
