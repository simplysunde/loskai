import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import App from "./App";
import { json } from "./test/render";

const DEFAULTS: Record<string, unknown> = {
  "/api/auth/status": { authed: true, needs_setup: false, user: { username: "admin", level: 4, tabs: ["routing", "docker", "machines"] } },
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
      json(RESPONSES[path] ?? {}),
    ),
  );
});

afterEach(() => {
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


// Before any account exists there is one thing to do, whatever address was opened: the
// Dashboard would be empty, and the account form used to hide behind its Log in.
test("until an account exists, every address shows first-run setup", async () => {
  RESPONSES["/api/auth/status"] = {
    authed: false, needs_setup: true, user: null,
    setup: { base_domain: { value: "example.no", source: "env", secret: false } },
  };
  renderAt("/docker");

  expect(await screen.findByRole("heading", { name: "Welcome to Loskai" })).toBeInTheDocument();
  expect(screen.getByLabelText("Base Domain")).toHaveValue("example.no");
  expect(screen.getByLabelText("Base Domain")).toBeDisabled();
  expect(screen.queryByRole("link", { name: "Routing" })).not.toBeInTheDocument();
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

// The look is the whole Loskai's: a logged-out visitor on the login page wears it too, this
// browser keeps it for the next first paint, and the legacy look takes it off again.
test("the look comes from the public payload, even on the login page, and is remembered", async () => {
  RESPONSES["/api/auth/status"] = { authed: false, needs_setup: false, user: null };
  RESPONSES["/api/dashboard"] = { services: [], certificate_tab: "public", ui_look: "simplysunde" };
  renderAt("/login");

  await waitFor(() => expect(document.documentElement).toHaveClass("brand"));
  expect(localStorage.getItem("loskai-look")).toBe("simplysunde");

  cleanup();
  RESPONSES["/api/dashboard"] = { services: [], certificate_tab: "public", ui_look: "legacy" };
  renderAt("/login");
  await waitFor(() => expect(document.documentElement).not.toHaveClass("brand"));
  expect(localStorage.getItem("loskai-look")).toBe("legacy");
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

// An account sees the tabs its level reaches, and Settings only an admin.
test("a level 2 account's sidebar has Routing and Docker, and Settings says it's an admin's", async () => {
  RESPONSES["/api/auth/status"] = { authed: true, needs_setup: false, user: { username: "ola", level: 2, tabs: ["routing", "docker"] } };
  renderAt("/settings");

  expect(await screen.findByText("Only an admin can open this.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Routing" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Docker" })).toBeInTheDocument();
  for (const tab of ["Machines", "Settings"]) {
    expect(screen.queryByRole("link", { name: tab })).not.toBeInTheDocument();
  }
  expect(screen.getByText("ola")).toBeInTheDocument();

  fireEvent.click(screen.getByTitle("Your account"));
  expect(screen.getByText("Level 2 — Docker")).toBeInTheDocument();
});

// jsdom has no screen width, so this checks the classes: the sidebar hidden until the menu
// opens it, and closed again by a pick.
test("on a phone, the menu opens the sidebar as a drawer, and a pick closes it", async () => {
  renderAt("/");
  const sidebar = (await screen.findByRole("link", { name: "Routing" })).closest("aside")!;
  expect(sidebar).toHaveClass("hidden");

  fireEvent.click(screen.getByRole("button", { name: "Menu" }));
  expect(sidebar).not.toHaveClass("hidden");

  fireEvent.click(screen.getByRole("link", { name: "Routing" }));
  expect(sidebar).toHaveClass("hidden");
});

// Narrowed, each tab is its icon, named in its tooltip; the next page load remembers it.
test("the sidebar collapses to its icons, and stays so", async () => {
  localStorage.removeItem("loskai-sidebar");
  renderAt("/");
  // Once the account is read: the tabs are its own.
  await screen.findByText("admin");
  const routing = screen.getByRole("link", { name: "Routing" });
  const sidebar = routing.closest("aside")!;
  expect(sidebar).toHaveClass("md:w-56");
  expect(within(routing).getByText("Routing")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Collapse the sidebar" }));
  expect(sidebar).toHaveClass("md:w-14");
  expect(within(routing).queryByText("Routing")).toBeNull();
  expect(routing).toHaveAttribute("title", expect.stringMatching(/^Routing/));
  expect(within(sidebar).queryByText("homelab control")).toBeNull();
  expect(within(sidebar).queryByText("admin")).toBeNull();
  fireEvent.click(screen.getByTitle("Your account"));
  expect(screen.getByText(/^admin · Level/)).toBeInTheDocument();
  expect(localStorage.getItem("loskai-sidebar")).toBe("slim");

  cleanup();
  renderAt("/");
  expect((await screen.findByRole("link", { name: "Routing" })).closest("aside")).toHaveClass("md:w-14");
  fireEvent.click(screen.getByRole("button", { name: "Expand the sidebar" }));
  expect(screen.getByText("homelab control")).toBeInTheDocument();
  expect(localStorage.getItem("loskai-sidebar")).toBeNull();
});

test("signed out, the sidebar offers Log in where your name would be", async () => {
  RESPONSES["/api/auth/status"] = { authed: false, needs_setup: false, user: null };
  renderAt("/");

  expect(await screen.findByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  expect(screen.queryByTitle("Your account")).not.toBeInTheDocument();
});

test("signed in, there is no Log in", async () => {
  renderAt("/");

  await screen.findByTitle("Your account");
  expect(screen.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
});

test("Log out is in the menu on your name, and lands on the Dashboard", async () => {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign, pathname: "/settings" });
  renderAt("/settings");
  fireEvent.click(await screen.findByTitle("Your account"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Log out" }));

  await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  expect(vi.mocked(fetch).mock.calls.some(([path]) => path === "/api/logout")).toBe(true);
});

test("a logout that fails says so, and stays", async () => {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign, pathname: "/" });
  const ok = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (path, init) =>
    path === "/api/logout"
      ? new Response(JSON.stringify({ detail: "Cross-origin request refused" }), { status: 403 })
      : ok(path, init),
  );
  renderAt("/");
  fireEvent.click(await screen.findByTitle("Your account"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Log out" }));

  expect(await screen.findByText("Not logged out: Cross-origin request refused")).toBeInTheDocument();
  expect(assign).not.toHaveBeenCalled();
});

test("your name in the sidebar opens a menu: change your password, or log out", async () => {
  renderAt("/");
  fireEvent.click(await screen.findByTitle("Your account"));

  expect(screen.getByText("Level 4 — Settings")).toBeInTheDocument();
  expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Change password", "Log out"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Change password" }));

  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-password" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a new password" } });
  fireEvent.change(screen.getByLabelText("New password again"), { target: { value: "a new password" } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));

  expect(await screen.findByText(/Changed\. Your other devices are signed out\./)).toBeInTheDocument();
  const post = vi.mocked(fetch).mock.calls.find(([path]) => path === "/api/auth/password");
  expect(JSON.parse(String(post![1]!.body))).toEqual({ current: "old-password", new: "a new password" });
});
