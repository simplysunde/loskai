# Loskai frontend

React, TypeScript, Vite and TanStack Query. One page per tab in `src/pages/`, components in
`src/components/{docker,routing,settings,shared}/`, hooks and the API client in `src/lib/`.

```bash
npm run dev          # Vite on :5173, /api proxied to :8000 (or LOSKAI_API)
npm test             # vitest
npm run build        # tsc -b (the tests too), then the bundle
npx oxlint src       # lint
```

How to run it with the backend, and the checks before a pull request:
[CONTRIBUTING.md](../CONTRIBUTING.md). A page, table or dialog has to work on a phone too:
[phone-layout.md](../docs/contributing/phone-layout.md).
