import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { SshKey } from "../../lib/ssh";
import { SshKeySection } from "./SshKeySection";

const KEY: SshKey = {
  public_key: "ssh-ed25519 AAAAC3Nza loskai",
  fingerprint: "SHA256:Ap4hJGzRxN2kq9uE0vWzvSPnKCN7tL1cX3m6oQyGcYk",
  authorized_keys: 'from="192.168.10.216" ssh-ed25519 AAAAC3Nza loskai',
  lines: [
    'from="192.168.10.216" ssh-ed25519 AAAAC3Nza loskai',
    'restrict,from="192.168.10.216",command="…" ssh-ed25519 AAAAST loskai-status',
  ],
  from: "192.168.10.216",
  unlocked_until: null,
};

afterEach(() => vi.unstubAllGlobals());

function renderSection(key: SshKey | null, replace: { status: number; body: unknown } = { status: 200, body: KEY }) {
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) => {
    const answer = path === "/api/ssh" ? { status: 200, body: { key, hosts: {}, trusted: {} } } : replace;
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <SshKeySection />
    </QueryClientProvider>,
  );
  return { fetchMock };
}

function enterPassword(password: string) {
  const field = screen.getByLabelText("Your password");
  fireEvent.change(field, { target: { value: password } });
  fireEvent.submit(field.closest("form")!);
}

test("no key yet: nothing to do here — a machine's SSH setup makes it", async () => {
  renderSection(null);

  expect(await screen.findByText("None yet.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /New key/ })).not.toBeInTheDocument();
});

test("the key is shown by its fingerprint only; New key replaces it after a warning", async () => {
  const { fetchMock } = renderSection(KEY);

  expect(await screen.findByText(KEY.fingerprint)).toBeInTheDocument();
  expect(screen.queryByText(KEY.authorized_keys)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /New key/ }));
  expect(screen.getByText(/until their SSH setup is run again/)).toBeInTheDocument();
  enterPassword("hunter2hunter2");

  await waitFor(() => expect(fetchMock.mock.calls.some(([p]) => p === "/api/ssh/key")).toBe(true));
  const [, init] = fetchMock.mock.calls.find(([p]) => p === "/api/ssh/key")!;
  expect(JSON.parse(init?.body as string)).toEqual({ password: "hunter2hunter2", replace: true });
});

test("a wrong password is said in the dialog, which stays open", async () => {
  renderSection(KEY, { status: 403, body: { detail: "Invalid password" } });

  fireEvent.click(await screen.findByRole("button", { name: /New key/ }));
  enterPassword("wrong");

  expect(await screen.findByText("Invalid password")).toBeInTheDocument();
  expect(screen.getByLabelText("Your password")).toBeInTheDocument();
});

test("a key not limited to the Docker host says so", async () => {
  renderSection({ ...KEY, from: null, authorized_keys: KEY.public_key });

  expect(await screen.findByText(/Not limited to the Docker host/)).toBeInTheDocument();
});
