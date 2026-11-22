import { expect, test } from "vitest";

import { commentText, factsQuery, keyGroup, keyLabel, keyPage, keyUnlocked, keyUses, remoteSshHost, takesKeysOff, webOf, type Facts, type KeyUse, type MachineKey, type SshStatus } from "./ssh";

const later = new Date(Date.now() + 60_000).toISOString();
const status = (key: SshStatus["key"], trusted: Record<string, boolean>): SshStatus => ({ key, hosts: {}, trusted, targets: {}, projects: {}, git_sites: [] });
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
     "https://github.com/a/b", "http://x:3000/a", "/srv/x", "file:///x", "ext::sh -c x"].map(remoteSshHost),
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
      // ssh's defaults, whether there or not: id_ecdsa isn't.
      "github.com": { hostname: "github.com", identities_only: false, keys: ["id_ecdsa", "id_ed25519", "id_rsa"] },
      "gh-page": { hostname: "github.com", identities_only: true, keys: ["page"] },
    },
    ssh_keys: ["id_ed25519", "id_rsa", "deploy_blog", "page"].map((name) => ({ name })),
  } as unknown as Facts;
  const uses = keyUses(facts)!;
  const where = (k: string) => (uses.get(k) ?? []).map((u) => `${u.repo}${u.module ? `/${u.module}` : ""} ${u.way}`);
  expect(where("id_ed25519")).toEqual(["site fetch and push"]);
  expect(where("id_rsa")).toEqual(["site fetch and push"]);
  expect(where("deploy_blog")).toEqual(["blog fetch and push"]);
  expect(where("page")).toEqual(["blog/page push"]);
  expect(uses.has("id_ecdsa")).toBe(false);
  // Two keys tried on github.com: each only offered there. One of a project's own, or one
  // IdentitiesOnly picks, is used.
  expect(uses.get("id_ed25519")![0].offered).toBe(true);
  expect(uses.get("deploy_blog")![0].offered).toBe(false);
  expect(uses.get("page")![0]).toMatchObject({ host: "gh-page", hostname: "github.com", offered: false });
  // With one account key, it is the one.
  const one = keyUses({ ...facts, ssh_keys: [{ name: "id_ed25519" }] } as unknown as Facts)!;
  expect(one.get("id_ed25519")![0].offered).toBe(false);
  expect(keyUses({ ...facts, remotes: null } as Facts)).toBeNull();
});

test("a remote's web page: an SSH address over https on its real host, an http(s) one as it is", () => {
  expect(webOf("git@github.com:me/site.git")).toBe("https://github.com/me/site");
  expect(webOf("git@gh-site:me/site.git", "github.com")).toBe("https://github.com/me/site");
  expect(webOf("ssh://git@forgejo.lan:2222/me/site.git")).toBe("https://forgejo.lan/me/site");
  expect(webOf("http://192.168.10.216:3000/me/site.git")).toBe("http://192.168.10.216:3000/me/site");
  expect(webOf("https://me:token@github.com/me/site.git/")).toBe("https://github.com/me/site");
  expect(webOf("/srv/site.git")).toBeNull();
});

test("where a key goes: a deploy key to its repository, another to the account on its platform", () => {
  const key = (name: string, comment = "vm@box") => ({ name, comment }) as MachineKey;
  const use = (url: string, hostname: string) => ({ url, hostname }) as KeyUse;
  expect(keyPage(key("deploy_site"), [use("git@github.com:me/site.git", "github.com")])?.url).toBe(
    "https://github.com/me/site/settings/keys",
  );
  // Deploy by its comment, through an alias — the push of a submodule.
  expect(keyPage(key("simplysunde-site", "simplysunde.github.io deploy key (vm)"), [use("git@gh-site:me/page.git", "github.com")])?.url).toBe(
    "https://github.com/me/page/settings/keys",
  );
  // An account key: the page of the git site its host is — as the server lists them.
  const sites = [
    { name: "GitHub", web: "https://github.com", ssh: "github.com", keys: "https://github.com/settings/ssh/new", builtin: true },
    { name: "Forgejo", web: "http://192.168.1.216:3000", ssh: "192.168.1.216:222", keys: "http://192.168.1.216:3000/user/settings/keys", builtin: false },
  ];
  expect(keyPage(key("id_ed25519"), [use("git@github.com:me/a.git", "github.com")], sites)).toEqual({
    url: "https://github.com/settings/ssh/new", where: "your GitHub account's SSH keys", label: "Add to GitHub" });
  // A Forgejo added there: its own web address, not one guessed from its SSH host.
  expect(keyPage(key("id_ed25519"), [use("ssh://git@192.168.1.216:222/me/a.git", "192.168.1.216")], sites)?.url).toBe(
    "http://192.168.1.216:3000/user/settings/keys");
  // One that isn't: a Forgejo's page, guessed on its host.
  expect(keyPage(key("id_ed25519"), [use("git@forgejo.lan:me/a.git", "forgejo.lan")], sites)?.url).toBe("https://forgejo.lan/user/settings/keys");
  // Used nowhere yet: its comment's "for <host>", else nothing to say.
  expect(keyPage(key("codeberg.org", "vm@box for codeberg.org"), [])?.url).toBe("https://codeberg.org/user/settings/keys");
  expect(keyPage(key("id_ed25519"), [])).toBeNull();
  // On two platforms, or a deploy key on two repositories: no single place.
  expect(keyPage(key("id_ed25519"), [use("git@github.com:a/b", "github.com"), use("git@forgejo.lan:a/b", "forgejo.lan")])).toBeNull();
});

test("what a key is for, written on it, comes before any guess", () => {
  expect(keyLabel("vm@box (loskai: for github.com)")).toEqual({ kind: "for", host: "github.com" });
  expect(keyLabel("vm@box (loskai: deploy site)")).toEqual({ kind: "deploy", project: "site" });
  expect(keyLabel("vm@box (loskai: login)")).toEqual({ kind: "login" });
  expect(keyLabel("vm@box deploy key")).toBeNull();
  expect(commentText("vm@box (loskai: account)")).toBe("vm@box");
  const key = (name: string, comment: string) => ({ name, comment }) as MachineKey;
  // Named deploy_, labelled for a platform: the label wins — but the platform is a tag only
  // while a remote uses it there, so an unused key never looks like a live one.
  expect(keyGroup(key("deploy_site", "vm@box (loskai: for github.com)"), [])).toEqual({ group: "account", tag: null });
  // An odd name, labelled a deploy key: its project, with no remote to say its repository.
  expect(keyGroup(key("odd", "vm@box (loskai: deploy site)"), [])).toEqual({ group: "deploy", tag: "site" });
  expect(keyGroup(key("id_ed25519", "vm@box (loskai: login)"), [])).toEqual({ group: "login", tag: null });
  // Unlabelled, nothing to go on: other.
  expect(keyGroup(key("work", "me@laptop"), [])).toEqual({ group: "other", tag: null });
});

test("a remote's pushurl is its own: another remote in the project still fetches and pushes", () => {
  const facts = {
    ok: true,
    projects: [{ path: "site", folder: "", name: "site", key: null }],
    remotes: [
      { path: "site", module: "", remote: "origin", kind: "url", url: "git@github.com:me/site.git" },
      { path: "site", module: "", remote: "mirror", kind: "url", url: "git@github.com:me/mirror.git" },
      { path: "site", module: "", remote: "mirror", kind: "pushurl", url: "git@github.com:me/mirror-push.git" },
    ],
    ssh_hosts: { "github.com": { hostname: "github.com", identities_only: false, keys: ["id_ed25519"] } },
    ssh_keys: [{ name: "id_ed25519" }],
  } as unknown as Facts;
  expect(keyUses(facts)!.get("id_ed25519")!.map((u) => `${u.url} ${u.way}`)).toEqual([
    "git@github.com:me/site.git fetch and push",
    "git@github.com:me/mirror.git fetch",
    "git@github.com:me/mirror-push.git push",
  ]);
});

test("one machine's overview is read every minute; every machine's at once, once", () => {
  expect(factsQuery("nas").refetchInterval).toBe(60_000);
  expect(factsQuery("nas", false).refetchInterval).toBe(false);
});

