# Caddy for the co-located (all-in-Docker) setup.
#
# Two build targets, because a DNS-challenge plugin has to be *compiled into* the binary —
# unlike the LXC path, which can swap builds at runtime with `caddy add-package`:
#
#   stock (default)  stock Caddy, internal CA. No compile, no plugin, nothing to configure.
#   acme             Caddy rebuilt with one caddy-dns plugin for public certs via DNS-01.
#                    Takes a few minutes: it is a Go build.
#
# Compose picks the target and the config; see compose.colocated.yml. By hand:
#   docker build ./caddy
#   docker build ./caddy --target acme --build-arg CADDY_DNS_PLUGIN=github.com/caddy-dns/cloudflare
#
# Both targets carry both Caddyfiles; which one Caddy reads is chosen at run time, so the
# same image serves either mode as far as config goes — only the binary differs.

FROM caddy:2 AS base
COPY Caddyfile Caddyfile.acme /etc/caddy/
COPY setup/ /srv/setup/

# --- Public ACME certs: one caddy-dns plugin compiled in -----------------------------------
FROM caddy:2-builder AS builder
# The module for whoever hosts your DNS: https://github.com/orgs/caddy-dns/repositories
ARG CADDY_DNS_PLUGIN=github.com/caddy-dns/cloudflare
RUN xcaddy build --with "${CADDY_DNS_PLUGIN}" --output /usr/bin/caddy

FROM base AS acme
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# --- Default: stock Caddy, internal CA -----------------------------------------------------
# Last on purpose: a `docker build` with no --target builds the *final* stage, so this ordering
# is what makes the plugin-free build the default. With `acme` last, a plain build silently
# produced a Go-compiled binary carrying a plugin nobody asked for.
FROM base AS stock
