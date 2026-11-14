import { expect, test } from "vitest";

import { keyUnlocked, keyUses, sshHost, takesKeysOff, type Facts, type SshStatus } from "./ssh";

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

test("an SSH remote's host — scp-like or ssh:// — and none for another transport", () => {
  expect(
    ["git@github.com:a/b.git", "ssh://git@forgejo.lan:2222/a/b.git", "git@gh-site:a/b.git",
     "https://github.com/a/b", "http://x:3000/a", "/srv/x", "file:///x", "ext::sh -c x"].map(sshHost),
  ).toEqual(["github.com", "forgejo.lan", "gh-site", null, null, null, null, null]);
});

test("a key is used where its project names it, else where ssh offers it the remote's host", () => {
  const facts = {
    ok: true,
    projects: [
      { path: "site", folder: "", name: "site", key: null },
      { path: "blog", folder: "", name: "blog", key: "deploy_blog" },
      { path: "odd", folder: "", name: "odd", key: "" },
    ],
    remotes: [
      { path: "site", module: "", kind: "url", url: "git@github.com:me/site.git" },
      { path: "blog", module: "", kind: "url", url: "git@github.com:me/blog.git" },
      { path: "odd", module: "", kind: "url", url: "git@github.com:me/odd.git" },
      // The project's own key is its own repo's: a submodule goes by ssh.
      { path: "blog", module: "page", kind: "url", url: "https://github.com/me/page.git" },
      { path: "blog", module: "page", kind: "pushurl", url: "git@gh-page:me/page.git" },
    ],
    ssh_hosts: {
      "github.com": { hostname: "github.com", identities_only: false, keys: ["id_ed25519", "id_rsa"] },
      "gh-page": { hostname: "github.com", identities_only: true, keys: ["page"] },
    },
  } as unknown as Facts;
  const uses = keyUses(facts)!;
  const where = (k: string) => (uses.get(k) ?? []).map((u) => `${u.repo}${u.module ? `/${u.module}` : ""} ${u.way}`);
  expect(where("id_ed25519")).toEqual(["site fetch and push"]);
  expect(where("id_rsa")).toEqual(["site fetch and push"]);
  expect(where("deploy_blog")).toEqual(["blog fetch and push"]);
  expect(where("page")).toEqual(["blog/page push"]);
  expect(uses.get("page")![0]).toMatchObject({ host: "gh-page", hostname: "github.com" });
  expect(keyUses({ ...facts, remotes: null } as Facts)).toBeNull();
});
