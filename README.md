# Flytdokk

A single Docker container that acts as the control plane for your entire homelab.

## Documentation

- [Migrating an existing project into a FlytDokk stack](docs/migration.md) — how (and when) to adopt an existing Docker Compose project into the Stack Manager.
- [Caddy Admin API endpoints FlytDokk uses](docs/caddy-api.md) — the exact subset of the Caddy API the routing module calls, and why.
- [AdGuard Home REST API endpoints FlytDokk uses](docs/adguard-api.md) — the DNS-rewrite subset of the AdGuard API the DNS module calls, and why.