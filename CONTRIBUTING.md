# Contributing

## Run it from source

```bash
make install-backend install-frontend
make backend      # API on :8000
make frontend     # UI on :5173, proxies /api to :8000
```

To point it at a real Caddy and AdGuard without a homelab, see
[dev-testing.md](docs/contributing/dev-testing.md).

## Before you open a pull request

There is no CI, so run the checks yourself:

```bash
make test-backend                     # pytest
make test-frontend                    # vitest
cd frontend && npm run build          # also type-checks the tests
make check-docs                       # links, page headers, and the docs against the code
```

- **Update the docs in the same commit as the behaviour.** Drifting docs are this project's
  most common bug, which is what `check-docs` is for. Where each kind of information goes is
  in [docs/README.md](docs/README.md#conventions).
- **Read [`HISTORY.md`](HISTORY.md) before reversing a decision.** Several current ones are
  walk-backs of earlier attempts, with the reason recorded.
- **Keep I/O out of the logic.** Each module's `client.py` only talks to the network; all
  decisions live in pure functions, which is what lets the tests run without one.
- **Recipes live in their own repo** — the format is
  [recipe-schema.md](docs/reference/recipe-schema.md).

The architecture and the reasons behind it are in [`PLAN.md`](PLAN.md); what is being worked
on is in [`TODO.md`](TODO.md).
