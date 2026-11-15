import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";

import { Routing } from "./Routing";
import { renderWithQuery, json } from "../test/render";

const ADGUARD_ROUTE = {
  id: "adguard", name: "AdGuard", type: "external", kind: "service", subdomain: "adguard",
  fqdn: "adguard.example.no", upstream: "192.168.10.230:3000", origin: "adguard",
  url: "http://adguard.example.no", private: false, routed: true, synced: true,
};

let calls: { path: string; method: string; body: unknown }[] = [];

function stubApi(routes: unknown[], caddy: unknown = undefined) {
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
            ? { adguard: { status: "healthy", url: "http://192.168.10.230:3000", answer_ip: "192.168.10.216" }, caddy }
            : path === "/api/settings"
              ? { base_domain: { value: "example.no", source: "settings" } }
              : path === "/api/adguard/status"
                ? { answer_ip: null, instances: [] }
                : path === "/api/routes"
                  ? { caddy: "ok", adguard: "ok", url: "https://adguard.example.no", warning: null }
                  : [];
      return json(data);
    }),
  );
}


function renderPage() {
  renderWithQuery(
    <MemoryRouter>
      <Routing />
    </MemoryRouter>,
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

  // Where it opens is the server's url — an http route here — never put together in the page.
  expect(
    await screen.findByRole("link", { name: "Open AdGuard at adguard.example.no" }),
  ).toHaveAttribute("href", "http://adguard.example.no");
  expect(screen.queryByRole("button", { name: "Route AdGuard" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "adguard.example.no" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("AdGuard's route");
});

function failing(method: string, path: string, detail: string) {
  const ok = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (p, init) =>
    (init?.method ?? "GET") === method && String(p) === path
      ? json({ detail }, 502)
      : ok(p, init),
  );
}

test("a delete that fails says why in its dialog, which stays open", async () => {
  stubApi([ADGUARD_ROUTE]);
  failing("DELETE", "/api/instances/adguard", "Caddy is unreachable");
  renderPage();

  fireEvent.click(await screen.findByTitle("Delete instance"));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  expect(await screen.findByText("Caddy is unreachable")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Delete instance" })).toBeInTheDocument();
});

test("a row action that fails says so above the table", async () => {
  stubApi([ADGUARD_ROUTE]);
  failing("PATCH", "/api/instances/adguard", "instance 'adguard' not found");
  renderPage();

  fireEvent.click(await screen.findByTitle("Public on dashboard"));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Couldn't change who sees it");
  expect(alert).toHaveTextContent("instance 'adguard' not found");
});


test("without Caddy nothing offers a route — not AdGuard's pill either — and links are added", async () => {
  stubApi([], { status: "unconfigured" });
  renderPage();

  expect(await screen.findByRole("link", { name: "Open AdGuard" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: /Add link/ })).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Route AdGuard" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Sync/ })).not.toBeInTheDocument();
});
