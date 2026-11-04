import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import App from "./App";

const DEFAULTS: Record<string, unknown> = {
  "/api/auth/status": { authed: true, needs_setup: false, user: { username: "admin", role: "admin", tabs: ["docker", "routing", "machines"] } },
  "/api/dashboard": { services: [], certificate_tab: "public" },
  "/api/caddy/root-certificate": {
    pem: "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n",
    common_name: "Caddy Local Authority",
    filename: "caddy-root.crt",
  },
  "/api/health": {
    caddy: { status: "healthy" },
    adguard: { status: "healthy" },
    wireguard: { status: "healthy" },
    docker: { status: "healthy" },
  },
};

let RESPONSES = { ...DEFAULTS };

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
  RESPONSES = { ...DEFAULTS };
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


// The Certificate tab is the only nav entry whose presence is configurable, and the
// setting is read from the *public* payload — the shell has to decide before anyone has
// logged in.
test("shows the Certificate tab to a logged-out visitor when it is public", async () => {
  RESPONSES["/api/auth/status"] = { authed: false, needs_setup: false, user: null };
  renderAt("/");

  expect(await screen.findByRole("link", { name: "Certificate" })).toBeInTheDocument();
});

test("hides the Certificate tab from a logged-out visitor in admin mode", async () => {
  RESPONSES["/api/auth/status"] = { authed: false, needs_setup: false, user: null };
  RESPONSES["/api/dashboard"] = { services: [], certificate_tab: "admin" };
  renderAt("/");

  await screen.findByRole("link", { name: "Dashboard" });
  expect(screen.queryByRole("link", { name: "Certificate" })).not.toBeInTheDocument();
});

test("shows it in admin mode once logged in", async () => {
  RESPONSES["/api/dashboard"] = { services: [], certificate_tab: "admin" };
  renderAt("/");

  expect(await screen.findByRole("link", { name: "Certificate" })).toBeInTheDocument();
});

// `hidden` takes the link out of the sidebar; it is not a lock. The root CA is public
// material, so anyone who has the URL still gets the page — including a device that was
// handed the link before someone flipped the setting.
test("keeps /certificate reachable even when the tab is hidden", async () => {
  RESPONSES["/api/dashboard"] = { services: [], certificate_tab: "hidden" };
  renderAt("/certificate");

  expect(await screen.findByRole("heading", { name: "Certificate" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Certificate" })).not.toBeInTheDocument();
});

// An operator sees the tabs it was given, and Settings only an admin.
test("an operator's sidebar has only its tabs, and Settings says it's an admin's", async () => {
  RESPONSES["/api/auth/status"] = { authed: true, needs_setup: false, user: { username: "ola", role: "operator", tabs: ["docker"] } };
  renderAt("/settings");

  expect(await screen.findByText("Only an admin can open this.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Docker" })).toBeInTheDocument();
  for (const tab of ["Routing", "Machines", "Settings"]) {
    expect(screen.queryByRole("link", { name: tab })).not.toBeInTheDocument();
  }
  expect(screen.getByText("ola")).toBeInTheDocument();

  fireEvent.click(screen.getByTitle("Your account"));
  expect(screen.getByText(/^Operator — Docker\. An admin changes this/)).toBeInTheDocument();
});

test("your name in the sidebar opens your account, where you change your password", async () => {
  renderAt("/");
  fireEvent.click(await screen.findByTitle("Your account"));

  expect(screen.getByText("Your account")).toBeInTheDocument();
  expect(screen.getByText(/^Admin — every tab/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-password" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a new password" } });
  fireEvent.change(screen.getByLabelText("New password again"), { target: { value: "a new password" } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));

  expect(await screen.findByText(/Changed\. Your other devices are signed out\./)).toBeInTheDocument();
  const post = vi.mocked(fetch).mock.calls.find(([path]) => path === "/api/auth/password");
  expect(JSON.parse(String(post![1]!.body))).toEqual({ current: "old-password", new: "a new password" });
});
