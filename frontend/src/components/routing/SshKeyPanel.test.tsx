import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { SshKey } from "../../lib/ssh";
import { SshKeyPanel } from "./SshKeyPanel";

const KEY: SshKey = {
  public_key: "ssh-ed25519 AAAAC3Nza loskai",
  authorized_keys: 'from="192.168.10.216" ssh-ed25519 AAAAC3Nza loskai',
  from: "192.168.10.216",
};

afterEach(() => vi.unstubAllGlobals());

function renderPanel(sshKey: SshKey | null, answer: { status: number; body: unknown } = { status: 200, body: KEY }) {
  const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) =>
    new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <SshKeyPanel sshKey={sshKey} />
    </QueryClientProvider>,
  );
  return { fetchMock };
}

function enterPassword(password: string) {
  const field = screen.getByLabelText("Admin password");
  fireEvent.change(field, { target: { value: password } });
  fireEvent.submit(field.closest("form")!);
}

test("with no key, creating one asks for the admin password", async () => {
  const { fetchMock } = renderPanel(null);

  fireEvent.click(screen.getByRole("button", { name: "Create key" }));
  enterPassword("hunter2hunter2");

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [path, init] = fetchMock.mock.calls[0];
  expect(path).toBe("/api/ssh/key");
  expect(JSON.parse(init?.body as string)).toEqual({ password: "hunter2hunter2", replace: false });
  await waitFor(() => expect(screen.queryByLabelText("Admin password")).not.toBeInTheDocument());
});

test("a wrong password is said in the dialog, which stays open", async () => {
  renderPanel(null, { status: 403, body: { detail: "Invalid password" } });

  fireEvent.click(screen.getByRole("button", { name: "Create key" }));
  enterPassword("wrong");

  expect(await screen.findByText("Invalid password")).toBeInTheDocument();
  expect(screen.getByLabelText("Admin password")).toBeInTheDocument();
});

test("a key shows the line to copy, and New key replaces it after a warning", async () => {
  const { fetchMock } = renderPanel(KEY);

  expect(screen.getByText(KEY.authorized_keys)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /New key/ }));
  expect(screen.getByText(/won't accept Loskai until they get the new line/)).toBeInTheDocument();
  enterPassword("hunter2hunter2");

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
    password: "hunter2hunter2",
    replace: true,
  });
});

test("a key not limited to the Docker host says so", () => {
  renderPanel({ ...KEY, from: null, authorized_keys: KEY.public_key });

  expect(screen.getByText(/Not limited to the Docker host/)).toBeInTheDocument();
});
