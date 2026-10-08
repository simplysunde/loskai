import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import { Routing } from "./Routing";

const ADGUARD_ROUTE = {
  id: "adguard", name: "AdGuard", type: "external", kind: "service", subdomain: "adguard",
  fqdn: "adguard.example.no", upstream: "192.168.10.230:3000", origin: "adguard",
  private: false, routed: true, synced: true,
};

let calls: { path: string; method: string; body: unknown }[] = [];

function stubApi(routes: unknown[]) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({
        path,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const data =
        path === "/api/caddy/routes"
          ? routes
          : path === "/api/health"
            ? { adguard: { status: "healthy", url: "http://192.168.10.230:3000", answer_ip: "192.168.10.216" } }
            : path === "/api/settings"
              ? { base_domain: { value: "example.no", source: "settings" } }
              : path === "/api/adguard/status"
                ? { answer_ip: null, instances: [] }
                : path === "/api/routes"
                  ? { caddy: "ok", adguard: "ok", url: "https://adguard.example.no", warning: null }
                  : [];
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routing />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("an unrouted AdGuard is routed from its pill, as the picker's Network source would", async () => {
  stubApi([]);
  renderPage();

  expect(await screen.findByRole("link", { name: "Open AdGuard" })).toHaveAttribute(
    "href",
    "http://192.168.10.230:3000",
  );
  // Each pill names its own address: AdGuard where it is reached, Caddy where rewrites point.
  expect(screen.getByText("192.168.10.230:3000")).toBeInTheDocument();
  expect(screen.getByText("192.168.10.216")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Route AdGuard" }));

  await waitFor(() => expect(calls.some((c) => c.path === "/api/routes")).toBe(true));
  expect(calls.find((c) => c.path === "/api/routes")).toMatchObject({
    method: "POST",
    body: { prefix: "adguard", upstream: "192.168.10.230:3000", origin: "adguard", name: "AdGuard" },
  });
});

test("a routed AdGuard opens at its name, and offers no second route", async () => {
  stubApi([ADGUARD_ROUTE]);
  renderPage();

  expect(
    await screen.findByRole("link", { name: "Open AdGuard at adguard.example.no" }),
  ).toHaveAttribute("href", "https://adguard.example.no");
  expect(screen.queryByRole("button", { name: "Route AdGuard" })).not.toBeInTheDocument();
  expect(screen.getByText("adguard.example.no", { selector: "span" })).toBeInTheDocument();
});
