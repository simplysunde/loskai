import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { SshKey } from "../../lib/ssh";
import { MachineTerminal } from "./MachineTerminal";

// xterm needs a real canvas; what matters here is which session opens, and when.
const sessions: { url: string; onClosed?: (code: number, reason: string) => void }[] = [];
vi.mock("../shared/XtermSession", () => ({
  XtermSession: (props: { url: string; onClosed?: (code: number, reason: string) => void }) => {
    sessions.push(props);
    return <div>shell at {props.url}</div>;
  },
}));

const KEY: SshKey = {
  public_key: "ssh-ed25519 AAAA loskai",
  fingerprint: "SHA256:main",
  authorized_keys: "ssh-ed25519 AAAA loskai",
  lines: [],
  from: null,
  unlocked_until: new Date(Date.now() + 60_000).toISOString(),
};

afterEach(() => {
  vi.unstubAllGlobals();
  sessions.length = 0;
});

function renderTerminal(sshKey: SshKey, unlockStatus = 200) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(unlockStatus === 200 ? KEY : { detail: "Invalid password" }), {
      status: unlockStatus,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MachineTerminal machine={{ id: "nas", name: "nas" }} sshKey={sshKey} onClose={() => {}} />
    </QueryClientProvider>,
  );
  return fetchMock;
}

test("an unlocked key opens the machine's shell at once", () => {
  renderTerminal(KEY);

  expect(screen.getByText("shell at /api/ssh/machines/nas/terminal")).toBeInTheDocument();
});

test("a locked key asks for the admin password, then connects", async () => {
  const fetchMock = renderTerminal({ ...KEY, unlocked_until: null });

  expect(screen.queryByText(/shell at/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "admin-pw" } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock and connect" }));

  expect(await screen.findByText(/shell at/)).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/ssh/unlock", expect.objectContaining({ method: "POST" }));
});

test("a wrong admin password says so and opens nothing", async () => {
  renderTerminal({ ...KEY, unlocked_until: null }, 403);

  fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "nope" } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock and connect" }));

  expect(await screen.findByText("Invalid password")).toBeInTheDocument();
  expect(screen.queryByText(/shell at/)).not.toBeInTheDocument();
});

test("a session the server closes as locked brings the password back", async () => {
  renderTerminal(KEY);

  sessions[sessions.length - 1].onClosed?.(4423, "Loskai's key is locked");

  expect(await screen.findByLabelText("Your password")).toBeInTheDocument();
});
