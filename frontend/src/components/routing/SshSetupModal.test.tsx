import { fireEvent, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { LoskaiKey } from "../../lib/ssh";
import { SshSetupModal } from "./SshSetupModal";
import { UnlockPrompt } from "../shared/UnlockPrompt";
import { renderWithQuery, json } from "../../test/render";

const FP = "SHA256:XwXWP1efObJOv+IhNojI/m+P5drO8my+LOVsqOVPaRQ";
const UNLOCKED: LoskaiKey = {
  public_key: "ssh-ed25519 AAAA loskai",
  fingerprint: "SHA256:main",
  lines: ['from="192.168.10.216" ssh-ed25519 AAAA loskai', 'restrict,command="…" ssh-ed25519 ST loskai-status'],
  from: "192.168.10.216",
  unlocked_until: new Date(Date.now() + 10 * 60_000).toISOString(),
};
const LOCKED: LoskaiKey = { ...UNLOCKED, unlocked_until: null };
const TESTED = {
  key: true,
  running: { ok: true, checked: 0, containers: [{ name: "web", image: "nginx", status: "Up", ports: [] }], services: ["nginx"], guests: [] },
};

type Answer = { status?: number; body: unknown };
let calls: { path: string; body: unknown }[] = [];


function renderModal(sshKey: LoskaiKey | null, answers: Record<string, Answer | Answer[]>) {
  calls = [];
  const queues = Object.fromEntries(
    Object.entries(answers).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path === "/api/auth/status") {
        return json({ authed: true, needs_setup: false, user: { username: "admin", level: 4, tabs: ["routing", "docker", "machines"] } });
      }
      const key = Object.keys(queues).find((k) => path.endsWith(k));
      const queue = key ? queues[key] : [];
      const answer = (queue.length > 1 ? queue.shift() : queue[0]) ?? { body: {} };
      return json(answer.body, answer.status ?? 200);
    }),
  );
  renderWithQuery(
    <>
    <SshSetupModal
      machine={{ id: "nas", name: "nas" }}
      user="loskai"
      target="loskai@nas.lan:2222"
      sshKey={sshKey}
      onClose={() => {}}
    />
    <UnlockPrompt />
    </>,
  );
}

const paths = () => calls.map((c) => c.path);

test("a new machine's host key is shown first, and nothing else is offered until it's trusted", async () => {
  renderModal(UNLOCKED, {
    "/scan": { body: { fingerprint: FP, type: "ssh-ed25519", state: "new" } },
    "/trust": { body: { fingerprint: FP, state: "trusted" } },
  });
  // The login is the server's, as it will connect — not put together here.
  expect(screen.getByText("loskai@nas.lan:2222")).toBeInTheDocument();

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
  expect(screen.queryByLabelText("Your password")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Install" }));

  expect(await screen.findByText("Loskai logs in with its key.")).toBeInTheDocument();
  expect(screen.getByText("2 running.")).toBeInTheDocument();
  expect(calls.filter((c) => c.path.endsWith("/install"))).toEqual([
    { path: "/api/ssh/machines/nas/install", body: { password: "machine-pw" } },
  ]);
  expect(paths()).not.toContain("/api/ssh/unlock");
});

test("a locked key asks for your password in the one dialog, then the install goes on with the machine's", async () => {
  renderModal(LOCKED, {
    "/scan": { body: { fingerprint: FP, type: "ssh-ed25519", state: "trusted" } },
    "/unlock": { body: UNLOCKED },
    "/install": [{ status: 423, body: { detail: "Loskai's key is locked — enter your password" } }, { body: TESTED }],
  });

  fireEvent.change(await screen.findByLabelText("Machine password"), { target: { value: "machine-pw" } });
  // No password field of its own for Loskai's key.
  expect(screen.queryByLabelText("Your password")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  const prompt = await screen.findByRole("dialog", { name: "Unlock Loskai's key" });
  fireEvent.change(within(prompt).getByLabelText("Your password"), { target: { value: "admin-pw" } });
  fireEvent.click(within(prompt).getByRole("button", { name: "Unlock" }));

  await screen.findByText("Loskai logs in with its key.");
  // Refused as locked, the password, then the install sent again — with the machine's password.
  expect(paths().filter((p) => p.startsWith("/api/ssh/")).slice(-3)).toEqual([
    "/api/ssh/machines/nas/install", "/api/ssh/unlock", "/api/ssh/machines/nas/install",
  ]);
  expect(calls.filter((c) => c.path.endsWith("/install")).at(-1)?.body).toEqual({ password: "machine-pw" });
  expect(calls.find((c) => c.path === "/api/ssh/unlock")?.body).toEqual({ password: "admin-pw" });
});

test("the password dialog cancelled, the setup says the key is locked", async () => {
  renderModal(UNLOCKED, {
    "/scan": { body: { fingerprint: FP, type: "ssh-ed25519", state: "trusted" } },
    "/test": { status: 423, body: { detail: "Loskai's key is locked — enter your password" } },
  });

  fireEvent.click(await screen.findByRole("tab", { name: "I'll add it myself" }));
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Unlock Loskai's key" })).getByRole("button", { name: "Cancel" }));

  expect(await screen.findByText(/key is locked/)).toBeInTheDocument();
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
  fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "admin-pw" } });
  fireEvent.click(screen.getByRole("button", { name: "Create key" }));

  await vi.waitFor(() => expect(paths()).toContain("/api/ssh/key"));
  expect(calls.find((c) => c.path === "/api/ssh/key")?.body).toEqual({ password: "admin-pw" });
});

test("a machine that can't be reached says so, with a retry", async () => {
  renderModal(UNLOCKED, { "/scan": { status: 502, body: { detail: "Can't reach 192.168.10.50:22" } } });

  expect(await screen.findByText(/Can't reach 192.168.10.50:22/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});
