import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import { Login } from "./Login";
import { json } from "../test/render";

let status: unknown;
const posts: { path: string; body: unknown }[] = [];

function renderLogin() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") posts.push({ path, body: JSON.parse(String(init.body)) });
      return json(path === "/api/auth/status" ? status : { authed: true });
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/routing" element={<p>routing</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  posts.length = 0;
});

test("first run creates the admin account with a username", async () => {
  status = { authed: false, needs_setup: true, user: null };
  renderLogin();

  expect(await screen.findByRole("heading", { name: "Create the admin account" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "sunde" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a long password" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a long password" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  await vi.waitFor(() =>
    expect(posts).toEqual([{ path: "/api/auth/setup", body: { username: "sunde", password: "a long password" } }]),
  );
});

test("a login sends the username and password", async () => {
  status = { authed: false, needs_setup: false, user: null };
  renderLogin();

  fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "ola" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "ola-password" } });
  expect(screen.queryByLabelText("Confirm password")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));

  await vi.waitFor(() => expect(posts).toEqual([{ path: "/api/login", body: { username: "ola", password: "ola-password" } }]));
});
