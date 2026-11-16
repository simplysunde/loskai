import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import { Setup } from "./Setup";
import { hostFromAddress } from "../lib/setup";
import type { SetupFields } from "../lib/useAuth";
import { json } from "../test/render";

const UNSET = { value: null, source: "unset", secret: false } as const;
const NOTHING_SET: SetupFields = {
  base_domain: UNSET, host_ip: UNSET, caddy_admin_url: UNSET,
  adguard_url: UNSET, adguard_user: UNSET, adguard_password: { ...UNSET, secret: true },
};

const posts: { path: string; body: unknown }[] = [];
let answer = () => json({ authed: true });

function renderSetup(fields: SetupFields = NOTHING_SET) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ path, body: JSON.parse(String(init.body)) });
        return answer();
      }
      return json({});
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Setup fields={fields} />} />
          <Route path="/routing" element={<p>routing</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fillAccount() {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "sunde" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a long password" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a long password" } });
}

afterEach(() => {
  posts.length = 0;
  answer = () => json({ authed: true });
});

test("one request makes the account and stores the answers, then opens Routing", async () => {
  renderSetup();

  expect(screen.getByRole("heading", { name: "Welcome to Loskai" })).toBeInTheDocument();
  expect(screen.getByLabelText("Base Domain")).toHaveValue("home.lan"); // a domain that works as it is
  fillAccount();
  fireEvent.change(screen.getByLabelText("Docker Host LAN IP"), { target: { value: "192.168.10.20" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "I want secure HTTPS connections" }));
  fireEvent.change(screen.getByLabelText("Caddy admin URL"), { target: { value: "http://192.168.10.101:2019" } });
  fireEvent.click(screen.getByRole("button", { name: "Start using Loskai" }));

  expect(await screen.findByText("routing")).toBeInTheDocument();
  expect(posts).toEqual([
    {
      path: "/api/auth/setup",
      body: {
        username: "sunde",
        password: "a long password",
        settings: {
          base_domain: "home.lan", host_ip: "192.168.10.20", caddy_admin_url: "http://192.168.10.101:2019",
          adguard_url: "", adguard_user: "", adguard_password: "",
        },
      },
    },
  ]);
});

// Loskai runs without Caddy and AdGuard, on links: their four fields are for whoever asks.
test("without HTTPS the page is the account and the network, and says the rest can wait", async () => {
  renderSetup();

  expect(screen.queryByLabelText("Caddy admin URL")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("AdGuard password")).not.toBeInTheDocument();
  expect(screen.getByText(/can be changed later, in Settings/)).toBeInTheDocument();
  fillAccount();
  fireEvent.click(screen.getByRole("button", { name: "Start using Loskai" }));

  await screen.findByText("routing");
  expect((posts[0].body as { settings: unknown }).settings).toEqual({ base_domain: "home.lan", host_ip: "" });
});

test("asking for HTTPS says what it needs; a change of mind sends none of it", async () => {
  renderSetup();
  const want = screen.getByRole("checkbox", { name: "I want secure HTTPS connections" });

  fireEvent.click(want);
  expect(screen.getByText(/Caddy and AdGuard Home/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "install guide" })).toHaveAttribute("href", expect.stringContaining("docs/guides/install.md"));
  fireEvent.change(screen.getByLabelText("AdGuard URL"), { target: { value: "http://192.168.10.2:3000" } });
  fireEvent.click(want);
  fillAccount();
  fireEvent.click(screen.getByRole("button", { name: "Start using Loskai" }));

  await screen.findByText("routing");
  expect((posts[0].body as { settings: unknown }).settings).toEqual({ base_domain: "home.lan", host_ip: "" });
});

test("what the compose file set is shown locked, and not sent", async () => {
  renderSetup({
    ...NOTHING_SET,
    caddy_admin_url: { value: "http://caddy:2019", source: "env", secret: false },
    adguard_password: { value: null, source: "env", secret: true },
  });

  // Already chosen in the compose file: its fields are there without asking.
  expect(screen.queryByRole("checkbox", { name: "I want secure HTTPS connections" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Caddy admin URL")).toHaveValue("http://caddy:2019");
  expect(screen.getByLabelText("Caddy admin URL")).toBeDisabled();
  expect(screen.getByLabelText("AdGuard password")).toBeDisabled(); // set, its value never sent here
  expect(screen.getByLabelText("AdGuard URL")).toBeEnabled();
  fillAccount();
  fireEvent.click(screen.getByRole("button", { name: "Start using Loskai" }));

  await screen.findByText("routing");
  const sent = (posts[0].body as { settings: Record<string, string> }).settings;
  expect(Object.keys(sent).sort()).toEqual(["adguard_url", "adguard_user", "base_domain", "host_ip"]);
});

test("a refused answer says why and keeps the page", async () => {
  answer = () => json({ detail: "Host IP must be a bare IP address (e.g. 192.168.10.50) — no scheme or port" }, 422);
  renderSetup();
  fillAccount();
  fireEvent.click(screen.getByRole("button", { name: "Start using Loskai" }));

  expect(await screen.findByText(/Host IP must be a bare IP address/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Welcome to Loskai" })).toBeInTheDocument();
  expect(screen.getByLabelText("Username")).toHaveValue("sunde"); // nothing typed is lost
});

test("passwords that differ are caught before anything is sent", () => {
  renderSetup();
  fillAccount();
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "another password" } });
  fireEvent.click(screen.getByRole("button", { name: "Start using Loskai" }));

  expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
  expect(posts).toEqual([]);
});

test("the Docker host's address is the one the page was opened on, when that is a LAN IP", () => {
  expect(hostFromAddress("192.168.10.20")).toBe("192.168.10.20");
  expect(hostFromAddress("100.101.102.103")).toBe("100.101.102.103");
  expect(hostFromAddress("loskai.home.lan")).toBe(""); // a name says nothing about the host
  expect(hostFromAddress("localhost")).toBe("");
  expect(hostFromAddress("127.0.0.1")).toBe(""); // this machine, not the host's LAN address
});
