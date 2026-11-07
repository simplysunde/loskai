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
- **Changed a page, a table or a dialog?** It has to work on a phone too —
  [phone-layout.md](docs/contributing/phone-layout.md) has the patterns, and
  `make check-phone` screenshots a running Loskai at phone widths to check it.
- **Read [`HISTORY.md`](docs/project/HISTORY.md) before reversing a decision.** Several
  current ones are walk-backs of earlier attempts, with the reason recorded.
- **Keep I/O out of the logic.** Each module's `client.py` only talks to the network; all
  decisions live in pure functions, which is what lets the tests run without one.
- **A new test starts from the shared setup.** Backend: `tests/conftest.py` gives every test
  its own data and stacks folders and keeps Docker away — ask for `data_dir` to reach the
  files. Frontend: `src/test/render.tsx` has `renderWithQuery` (a fresh query cache) and
  `json` (what a stubbed `fetch` answers); a `vi.stubGlobal` is undone after each test.
- **Recipes live in their own repo** — the format is
  [recipe-schema.md](docs/reference/recipe-schema.md).

The architecture and the reasons behind it are in [`architecture.md`](docs/project/architecture.md); what
is being worked on is in [`TODO.md`](docs/project/TODO.md).
