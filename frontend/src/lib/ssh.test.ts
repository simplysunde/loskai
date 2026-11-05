import { expect, test } from "vitest";

import { removalNeedsPassword, takesKeysOff, type SshStatus } from "./ssh";

const later = new Date(Date.now() + 60_000).toISOString();
const status = (key: SshStatus["key"], trusted: Record<string, boolean>): SshStatus => ({ key, hosts: {}, trusted, projects: {} });
const KEY = { public_key: "ssh-ed25519 AAAA loskai", fingerprint: "SHA256:x", lines: [], from: null, unlocked_until: null };

test("removing a set-up machine takes Loskai's key off it, and asks for your password while it is locked", () => {
  expect(takesKeysOff(status(KEY, { nas: true }), "nas")).toBe(true);
  expect(removalNeedsPassword(status(KEY, { nas: true }), "nas")).toBe(true);
  expect(removalNeedsPassword(status({ ...KEY, unlocked_until: later }, { nas: true }), "nas")).toBe(false);
  // Not set up, or no key: nothing to take off, so no password.
  expect(removalNeedsPassword(status(KEY, {}), "nas")).toBe(false);
  expect(removalNeedsPassword(status(null, { nas: true }), "nas")).toBe(false);
  expect(removalNeedsPassword(undefined, "nas")).toBe(false);
});
