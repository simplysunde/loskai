import { expect, test } from "vitest";

import { keyUnlocked, takesKeysOff, type SshStatus } from "./ssh";

const later = new Date(Date.now() + 60_000).toISOString();
const status = (key: SshStatus["key"], trusted: Record<string, boolean>): SshStatus => ({ key, hosts: {}, trusted, targets: {}, projects: {} });
const KEY = { public_key: "ssh-ed25519 AAAA loskai", fingerprint: "SHA256:x", lines: [], from: null, unlocked_until: null };

test("removing a set-up machine takes Loskai's key off it — not one never set up, or with no key", () => {
  expect(takesKeysOff(status(KEY, { nas: true }), "nas")).toBe(true);
  expect(takesKeysOff(status(KEY, {}), "nas")).toBe(false);
  expect(takesKeysOff(status(null, { nas: true }), "nas")).toBe(false);
  expect(takesKeysOff(undefined, "nas")).toBe(false);
});

test("the key is unlocked until its time, or for good when nothing asks for the password", () => {
  expect(keyUnlocked({ ...KEY, unlocked_until: later })).toBe(true);
  expect(keyUnlocked(KEY)).toBe(false);
  expect(keyUnlocked({ ...KEY, asks_password: false })).toBe(true);
  expect(keyUnlocked(null)).toBe(false);
});
