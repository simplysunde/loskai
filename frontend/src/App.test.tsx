import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import App from "./App";

const RESPONSES: Record<string, unknown> = {
  "/api/auth/status": { authed: true, password_set: true },
  "/api/health": {
    caddy: { status: "healthy" },
    adguard: { status: "healthy" },
    wireguard: { status: "healthy" },
    docker: { status: "healthy" },
  },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      new Response(JSON.stringify(RESPONSES[path] ?? {}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("an unmatched path explains itself and keeps the nav", () => {
  // The backend's SPA catch-all serves index.html for any unknown path, so this is the
  // only thing standing between a typo and Layout chrome around an empty pane.
  renderAt("/nope");

  expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  expect(screen.getByText("/nope")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Routing" })).toBeInTheDocument();
});
