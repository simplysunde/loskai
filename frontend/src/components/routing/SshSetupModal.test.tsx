import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { SshKey } from "../../lib/ssh";
import { SshSetupModal } from "./SshSetupModal";

const FP = "SHA256:XwXWP1efObJOv+IhNojI/m+P5drO8my+LOVsqOVPaRQ";
const UNLOCKED: SshKey = {
  public_key: "ssh-ed25519 AAAA loskai",
  authorized_keys: 'from="192.168.10.216" ssh-ed25519 AAAA loskai',
  lines: ['from="192.168.10.216" ssh-ed25519 AAAA loskai', 'restrict,command="…" ssh-ed25519 ST loskai-status'],
  from: "192.168.10.216",
  unlocked_until: new Date(Date.now() + 10 * 60_000).toISOString(),
};
const LOCKED: SshKey = { ...UNLOCKED, unlocked_until: null };
const TESTED = {
  key: true,
  running: { ok: true, checked: 0, containers: [{ name: "web", image: "nginx", status: "Up" }], services: ["nginx"], guests: [] },
};

type Answer = { status?: number; body: unknown };
let calls: { path: string; body: unknown }[] = [];

afterEach(() => vi.unstubAllGlobals());

function renderModal(sshKey: SshKey | null, answers: Record<string, Answer | Answer[]>) {
  calls = [];
  const queues = Object.fromEntries(
    Object.entries(answers).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      const key = Object.keys(queues).find((k) => path.endsWith(k));
      const queue = key ? queues[key] : [];
      const answer = (queue.length > 1 ? queue.shift() : queue[0]) ?? { body: {} };
      return new Response(JSON.stringify(answer.body), {
        status: answer.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <SshSetupModal
        machine={{ id: "nas", name: "nas" }}
        host={{ hostname: "192.168.10.50", user: "loskai", port: 22 }}
        sshKey={sshKey}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

const paths = () => calls.map((c) => c.path);

test("a new machine's host key is shown first, and nothing else is offered until it's trusted", async () => {
  renderModal(UNLOCKED, {
    "/scan": { body: { fingerprint: FP, type: "ssh-ed25519", state: "new" } },
    "/trust": { body: { fingerprint: FP, state: "trusted" } },
  });

  expect(await screen.findByText(FP)).toBeInTheDocument();
  expect(screen.queryByLabelText("Machine password")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Trust" }));

  expect(await screen.findByLabelText("Machine password")).toBeInTheDocument();
  expect(calls.find((c) => c.path.endsWith("/trust"))?.body).toEqual({ fingerprint: FP });
});

test("a changed host key is a warning, and trusting it is spelled out", async () => {
  renderModal(UNLOCKED, { "/scan": { body: { fingerprint: FP, type: "ssh-ed25519", state: "changed" } } });

  expect(await screen.findByText(/host key has changed/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Trust the new key" })).toBeInTheDocument();
});

test("Install sends the machine's password once, and shows what the test found", async () => {
  renderModal(UNLOCKED, {
    "/scan": { body: { fingerprint: FP, type: "ssh-ed25519", state: "trusted" } },
    "/install": { body: TESTED },
  });

  fireEvent.change(await screen.findByLabelText("Machine password"), { target: { value: "machine-pw" } });
  // The key is unlocked, so the admin password isn't asked for.
  expect(screen.queryByLabelText("Admin password")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Install" }));

  expect(await screen.findByText("Loskai logs in with its key.")).toBeInTheDocument();
  expect(screen.getByText("2 running.")).toBeInTheDocument();
  expect(calls.filter((c) => c.path.endsWith("/install"))).toEqual([
    { path: "/api/ssh/machines/nas/install", body: { password: "machine-pw" } },
  ]);
  expect(paths()).not.toContain("/api/ssh/unlock");
});

test("a locked key is unlocked with the admin password before the machine's is sent", async () => {
  renderModal(LOCKED, {
    "/scan": { body: { fingerprint: FP, type: "ssh-ed25519", state: "trusted" } },
    "/unlock": { body: UNLOCKED },
    "/install": { body: TESTED },
  });

  fireEvent.change(await screen.findByLabelText("Machine password"), { target: { value: "machine-pw" } });
  fireEvent.change(screen.getByLabelText("Admin password"), { target: { value: "admin-pw" } });
  fireEvent.click(screen.getByRole("button", { name: "Install" }));

  await screen.findByText("Loskai logs in with its key.");
  expect(paths().slice(-2)).toEqual(["/api/ssh/unlock", "/api/ssh/machines/nas/install"]);
  expect(calls.find((c) => c.path === "/api/ssh/unlock")?.body).toEqual({ password: "admin-pw" });
});

test("a key that locked meanwhile brings the admin password back", async () => {
  renderModal(UNLOCKED, {
    "/scan": { body: { fingerprint: FP, type: "ssh-ed25519", state: "trusted" } },
    "/test": { status: 423, body: { detail: "Loskai's key is locked — enter the admin password" } },
  });

  fireEvent.click(await screen.findByRole("tab", { name: "I'll add it myself" }));
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

  expect(await screen.findByLabelText("Admin password")).toBeInTheDocument();
  expect(screen.getByText(/key is locked/)).toBeInTheDocument();
});

test("I'll add it myself shows this machine's lines, then tests without any password", async () => {
  // The Docker host's from= also names Loskai's own networks, so its lines are its own.
  const own = ['from="192.168.10.216,172.18.0.0/16" ssh-ed25519 AAAA loskai', "restrict,… loskai-status"];
  renderModal(UNLOCKED, {
    "/scan": { body: { fingerprint: FP, type: "ssh-ed25519", state: "trusted", lines: own } },
    "/test": { body: TESTED },
  });

  fireEvent.click(await screen.findByRole("tab", { name: "I'll add it myself" }));
  expect(screen.getByText(/loskai-status/)).toHaveTextContent('from="192.168.10.216,172.18.0.0/16"');
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

  await screen.findByText("Loskai logs in with its key.");
  expect(calls.find((c) => c.path.endsWith("/test"))?.body).toBeNull();
});

test("with no key yet, the admin password creates it before anything is installed", async () => {
  renderModal(null, { "/scan": { body: { fingerprint: FP, type: "ssh-ed25519", state: "trusted" } } });

  expect(await screen.findByText("Loskai has no SSH key yet.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Machine password")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Admin password"), { target: { value: "admin-pw" } });
  fireEvent.click(screen.getByRole("button", { name: "Create key" }));

  await vi.waitFor(() => expect(paths()).toContain("/api/ssh/key"));
  expect(calls.find((c) => c.path === "/api/ssh/key")?.body).toEqual({ password: "admin-pw" });
});

test("a machine that can't be reached says so, with a retry", async () => {
  renderModal(UNLOCKED, { "/scan": { status: 502, body: { detail: "Can't reach 192.168.10.50:22" } } });

  expect(await screen.findByText(/Can't reach 192.168.10.50:22/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});
