# Caddy for the co-located (all-in-Docker) setup — built with a DNS-challenge plugin so
# it can obtain the wildcard *.BASE_DOMAIN cert. Swap the plugin to match your domain's
# DNS provider (Cloudflare, Route53, …); DuckDNS shown as one example.

FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/duckdns

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
