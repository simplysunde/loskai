import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { SshKey } from "../../lib/ssh";
import { MachineTerminal } from "./MachineTerminal";
import { json } from "../../test/render";

// xterm needs a real canvas; what matters here is which session opens, and when.
type Session = { url: string; first?: string; onClosed?: (code: number, reason: string) => void; onOutput?: (text: string) => void };
const sessions: Session[] = [];
vi.mock("../shared/XtermSession", () => ({
  XtermSession: (props: Session) => {
    sessions.push(props);
    return <div>shell at {props.url}</div>;
  },
}));

const KEY: SshKey = {
  public_key: "ssh-ed25519 AAAA loskai",
  fingerprint: "SHA256:main",
  lines: [],
  from: null,
  unlocked_until: new Date(Date.now() + 60_000).toISOString(),
};

afterEach(() => {
  sessions.length = 0;
});

function renderTerminal(sshKey: SshKey, unlockStatus = 200) {
  const fetchMock = vi.fn(async () =>
    json(unlockStatus === 200 ? KEY : { detail: "Invalid password" }, unlockStatus),
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

// --- An automatic run: sudo's password first, and it closes itself ---

type Reply = { status?: number; body: unknown };

function renderRun(replies: Reply[], run = { tool: "system", action: "update", title: "Update" }) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (!path.endsWith("/run")) return new Response("{}", { headers: { "Content-Type": "application/json" } });
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      const reply = replies.shift() ?? { body: {} };
      return json(reply.body, reply.status ?? 200);
    }),
  );
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MachineTerminal machine={{ id: "nas", name: "nas" }} sshKey={KEY} run={run} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { calls, onClose };
}

test("an automatic run asks for sudo's password, checked before its terminal opens, and closes when done", async () => {
  const { calls, onClose } = renderRun([
    { body: { automatic: true, needs_password: true, user: "loskai", ticket: null } },
    { status: 422, body: { detail: "sudo didn't accept that password for loskai" } },
    { body: { automatic: true, needs_password: true, ticket: "t1" } },
  ]);

  const field = await screen.findByLabelText("sudo password");
  expect(screen.getByText(/never stored or logged/)).toBeInTheDocument();
  expect(screen.getByText("loskai")).toBeInTheDocument();
  fireEvent.change(field, { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(await screen.findByText("sudo didn't accept that password for loskai")).toBeInTheDocument();
  expect(screen.queryByText(/shell at/)).toBeNull();

  fireEvent.change(field, { target: { value: "right" } });
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(
    await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=system&action=update&sudo_password=true"),
  ).toBeInTheDocument();
  // The ticket is the socket's first message, never in the URL the server's access log keeps.
  expect(sessions.at(-1)?.first).toBe(JSON.stringify({ type: "ticket", ticket: "t1" }));
  expect(calls.map((c) => c.body)).toEqual([
    { tool: "system", action: "update" },
    { tool: "system", action: "update", password: "wrong" },
    { tool: "system", action: "update", password: "right" },
  ]);

  sessions[sessions.length - 1].onClosed?.(1000, "");
  expect(onClose).toHaveBeenCalled();
});

test("a run sudo needs no password for opens at once; one that isn't automatic stays open when it ends", async () => {
  const { onClose } = renderRun([{ body: { automatic: false, needs_password: false, ticket: null } }],
    { tool: "tmux", action: "attach", target: "work", title: "Attach" } as never);

  expect(await screen.findByText(/shell at .*tool=tmux&action=attach&target=work$/)).toBeInTheDocument();
  expect(screen.queryByLabelText("sudo password")).toBeNull();
  sessions[sessions.length - 1].onClosed?.(1000, "");
  expect(onClose).not.toHaveBeenCalled();
});

test("a run that isn't automatic closes on the Enter its prompt asks for, not on a dropped connection", async () => {
  const attach = { tool: "system", action: "status", title: "Status" } as never;
  const first = renderRun([{ body: { automatic: false, needs_password: false, ticket: null } }], attach);
  await screen.findByText(/shell at/);
  // Drawn by tmux: the prompt comes with colour codes around it.
  sessions[sessions.length - 1].onOutput?.("up 3 days\r\n\x1b[1m[done, exit 0]\x1b[0m Enter closes this.\r\n");
  sessions[sessions.length - 1].onClosed?.(1000, "");
  expect(first.onClose).toHaveBeenCalled();
});

test("a key that locked before the run asks for your password first", async () => {
  renderRun([{ status: 423, body: { detail: "Loskai's key is locked — enter your password" } }]);

  expect(await screen.findByLabelText("Your password")).toBeInTheDocument();
});
