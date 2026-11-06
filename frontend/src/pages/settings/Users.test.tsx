import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { Users } from "./Users";
import { json } from "../../test/render";

const calls: { path: string; method: string; body: unknown }[] = [];
const ACCOUNTS = [
  { username: "admin", level: 4, tabs: ["routing", "docker", "machines"], created: 0 },
  { username: "ola", level: 2, tabs: ["routing", "docker"], created: 0 },
];
const SIGN_INS = [
  { at: "2026-11-06T10:01:00+00:00", user: "admin", from: "10.0.0.5", ok: true },
  { at: "2026-11-06T10:00:00+00:00", user: "root", from: "10.0.0.9", ok: false },
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
            : path === "/api/auth/logins"
              ? SIGN_INS
              : {};
      return json(body);
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Users />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  calls.length = 0;
});

test("lists the accounts with their levels", async () => {
  renderUsers();

  const ola = (await screen.findByText("ola")).closest("tr") as HTMLElement;
  expect(within(ola).getByText("2 — Docker")).toBeInTheDocument();
  expect(await screen.findByText("(you)")).toBeInTheDocument();
});

test("lists the sign-ins, a wrong password by the name typed", async () => {
  renderUsers();

  const root = (await screen.findByText("root")).closest("tr") as HTMLElement;
  expect(within(root).getByText("Wrong password")).toHaveClass("text-amber-300");
  expect(within(root).getByText("10.0.0.9")).toBeInTheDocument();
  expect(screen.getByText("Signed in")).toBeInTheDocument();
});

test("adding an account sends the level chosen, 1 unless another is picked", async () => {
  renderUsers();
  fireEvent.click(await screen.findByRole("button", { name: "Add user" }));

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "Kari" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "kari-password" } });
  expect(screen.getByLabelText(/^1 — Routing/)).toBeChecked();
  fireEvent.click(screen.getByLabelText(/^3 — Machines/));
  fireEvent.click(screen.getAllByRole("button", { name: "Add user" }).at(-1)!);

  await vi.waitFor(() =>
    expect(calls.find((c) => c.method === "POST")).toEqual({
      path: "/api/users", method: "POST",
      body: { username: "kari", password: "kari-password", level: 3 },
    }),
  );
});

test("saving an account asks who you are again, so the sidebar follows your own level", async () => {
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
