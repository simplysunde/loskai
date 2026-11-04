import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { Users } from "./Users";

const calls: { path: string; method: string; body: unknown }[] = [];
const ACCOUNTS = [
  { username: "admin", role: "admin", tabs: ["docker", "routing", "machines"], created: 0 },
  { username: "ola", role: "operator", tabs: ["docker"], created: 0 },
];

function renderUsers() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      const body =
        path === "/api/auth/status"
          ? { authed: true, needs_setup: false, user: ACCOUNTS[0] }
          : path === "/api/users" && !init?.method
            ? ACCOUNTS
            : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Users />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

test("lists the accounts, an operator with its tabs", async () => {
  renderUsers();

  const ola = (await screen.findByText("ola")).closest("tr") as HTMLElement;
  expect(within(ola).getByText("operator")).toBeInTheDocument();
  expect(within(ola).getByText("Docker")).toBeInTheDocument();
  expect(await screen.findByText("(you)")).toBeInTheDocument();
});

test("adding an operator needs a tab, and sends what was chosen", async () => {
  renderUsers();
  fireEvent.click(await screen.findByRole("button", { name: "Add user" }));

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "Kari" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "kari-password" } });
  const add = screen.getAllByRole("button", { name: "Add user" }).at(-1)!;
  expect(add).toBeDisabled(); // an operator with no tab
  fireEvent.click(screen.getByLabelText("Routing"));
  fireEvent.click(screen.getByLabelText("Machines"));
  fireEvent.click(add);

  await vi.waitFor(() =>
    expect(calls.find((c) => c.method === "POST")).toEqual({
      path: "/api/users", method: "POST",
      body: { username: "kari", password: "kari-password", role: "operator", tabs: ["routing", "machines"] },
    }),
  );
});

test("saving an account asks who you are again, so the sidebar follows your own role", async () => {
  renderUsers();
  await screen.findByText("(you)");
  fireEvent.click(screen.getByRole("button", { name: "Edit admin" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await vi.waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
  const patched = calls.findIndex((c) => c.method === "PATCH");
  await vi.waitFor(() =>
    expect(calls.slice(patched + 1).some((c) => c.path === "/api/auth/status")).toBe(true),
  );
});
