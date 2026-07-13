# Loskai

**Safe passage for your Docker deployments.**

A single Docker container that acts as the control plane for your entire homelab.

## Documentation

- [Migrating an existing project into a Loskai stack](docs/migration.md) — how (and when) to adopt an existing Docker Compose project into the Stack Manager.
- [Caddy Admin API endpoints Loskai uses](docs/caddy-api.md) — the exact subset of the Caddy API the routing module calls, and why.
- [AdGuard Home REST API endpoints Loskai uses](docs/adguard-api.md) — the DNS-rewrite subset of the AdGuard API the DNS module calls, and why.
- [Install-wizard recipe schema](docs/recipe-schema.md) — the `recipe.yml` manifest format the Docker module validates, the recipe folder layout, and the raw-stack alternative.