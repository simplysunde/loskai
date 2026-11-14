import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

// Loskai's SSH key (null until one is made) and each Host in its SSH config, by alias — a
// machine's entry is the one named after its hostname.
export interface SshKey {
  public_key: string;
  fingerprint: string; // SHA256:…, as ssh-keygen -lf prints it
  lines: string[]; // both lines a machine gets: the main key's, then the status key's
  from: string | null; // the Docker host's IP the keys are limited to
  unlocked_until: string | null; // when the main key locks again; null while locked
  asks_password?: boolean; // false: an admin switched off asking — it is never locked
}
// Whether the main key is unlocked now — for your account (the backend's `unlocked_until`),
// or for good, when nothing asks for the password.
export function keyUnlocked(key?: SshKey | null): boolean {
  if (key?.asks_password === false) return true;
  return Boolean(key?.unlocked_until && Date.parse(key.unlocked_until) > Date.now());
}

export interface SshHost {
  hostname?: string;
  user?: string;
  port: number;
}
export interface SshStatus {
  key: SshKey | null;
  hosts: Record<string, SshHost>;
  trusted: Record<string, boolean>; // machine ids with a trusted host key
  targets: Record<string, string>; // how the server reaches each machine with a user: "user@host[:port]"
  projects: Record<string, string>; // each machine's projects folder: "~/projects", "~"
}

// Whether removing a machine, or its SSH connection, takes Loskai's things off it first — it is
// set up (its host key trusted) and there is a key — which the confirmation says. While the
// key is locked, the server's 423 asks for your password (api.ts). Its own test is
// `connect.removal`.
export function takesKeysOff(ssh: SshStatus | undefined, machineId: string): boolean {
  return Boolean(ssh?.key && ssh.trusted[machineId]);
}

export function useSsh() {
  return useQuery({ queryKey: ["ssh"], queryFn: () => api.get<SshStatus>("/api/ssh") });
}

// A running Proxmox LXC or VM. `addresses`: its IPv4 ones (from status line v7; [] where
// unknown — a VM without the guest agent).
export interface Guest {
  id: string;
  name: string;
  kind: "lxc" | "vm";
  addresses?: string[];
}

// What runs on a machine, read with the status key (works while the main key is locked).
export interface Running {
  ok: boolean;
  error?: string;
  checked: number; // epoch seconds
  // `ports`: the TCP ports published off loopback ([] from a status line before v6).
  containers?: { name: string; image: string; status: string; ports: number[] }[];
  services?: string[];
  hidden?: number; // base-system services, counted not listed
  guests?: Guest[];
  // The ports services listen on — `host` "" for every address; null before status line v6.
  listening?: { service: string; port: number; host: string }[] | null;
  // Lists that can't be read: docker, pct, qm — and listen, when only the SSH user's own
  // processes' sockets could be read, ss when there's no ss (the Add route picker says so;
  // the running list doesn't).
  denied?: string[];
}

// By machine id. The backend asks each machine at most every 30 s, whoever is looking.
export function useRunning(enabled: boolean) {
  return useQuery({
    queryKey: ["ssh-running"],
    queryFn: () => api.get<Record<string, Running>>("/api/ssh/running"),
    refetchInterval: 30_000,
    enabled,
  });
}

export function runningCount(r: Running): number {
  return (r.containers?.length ?? 0) + (r.services?.length ?? 0) + (r.guests?.length ?? 0);
}

// A machine's overview, read with the status key (works while the main key is locked).
// One of the SSH user's keys, as ssh-keygen -l describes its public half.
export interface SshKeyInfo {
  name: string; // its file in ~/.ssh, without .pub
  bits: number;
  fingerprint: string; // SHA256:… — as GitHub and Forgejo list it
  comment: string;
  type: string; // ED25519, RSA, …
  public?: string | null; // its type and data — to paste; null before status line v13
}

// A remote's web page: an SSH address's host (an alias's HostName, given) over https, an
// http(s) one as it is, without .git — where GitHub and Forgejo show the repository.
export function webOf(url: string, hostname?: string): string | null {
  const ssh = /^ssh:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(url) ?? /^[^@/:]*@([^:/]+):(.+)$/.exec(url);
  const web = ssh
    ? `https://${hostname ?? ssh[1]}/${ssh[2]}`
    : /^https?:\/\//.test(url)
      ? url.replace(/^(https?:\/\/)[^/@]*@/, "$1")
      : null;
  return web ? web.replace(/\/+$/, "").replace(/\.git$/, "") : null;
}

// Where a key goes, to paste it: a deploy key — by name, or by its comment — on the
// repository it is used for (its Deploy keys page, the same path on GitHub and Forgejo);
// any other on your account, on the platform its remotes are on (or its comment's "for
// <host>"). Null where that can't be told.
export function keyPage(key: SshKeyInfo, uses: KeyUse[] | null): { url: string; where: string; label: string } | null {
  const repos = [...new Set((uses ?? []).map((u) => webOf(u.url, u.hostname)).filter(Boolean))] as string[];
  if (isDeploy(key)) {
    return repos.length === 1
      ? { url: `${repos[0]}/settings/keys`, where: "its repository's Deploy keys", label: "Add to repository" }
      : null;
  }
  const host = keyHost(key, uses);
  if (!host) return null;
  if (host === "github.com") return { url: "https://github.com/settings/ssh/new", where: "your GitHub account's SSH keys", label: "Add to GitHub" };
  if (host === "gitlab.com") return { url: "https://gitlab.com/-/user_settings/ssh_keys", where: "your GitLab account's SSH keys", label: "Add to GitLab" };
  return { url: `https://${host}/user/settings/keys`, where: `your account's SSH keys on ${host}`, label: `Add to ${host}` };
}

// What a key is for, as written on it: its comment's `(loskai: …)` — every key Loskai makes
// carries one, and Label puts one on any other. Null for a key without.
export type KeyLabel = { kind: "account" } | { kind: "login" } | { kind: "for"; host: string } | { kind: "deploy"; project: string };

export function keyLabel(comment: string): KeyLabel | null {
  const m = /\(loskai: (account|login|for ([A-Za-z0-9._-]+)|deploy ([A-Za-z0-9._-]+))\)$/.exec(comment);
  if (!m) return null;
  return m[2] ? { kind: "for", host: m[2] } : m[3] ? { kind: "deploy", project: m[3] } : { kind: m[1] as "account" | "login" };
}

// A key's comment without the mark: what was there before it.
export function commentText(comment: string): string {
  return comment.replace(/\s*\(loskai: [^)]*\)$/, "");
}

// A deploy key: by its mark, else by its name (Own key's) or a comment that says so.
function isDeploy(key: SshKeyInfo): boolean {
  const label = keyLabel(key.comment);
  if (label) return label.kind === "deploy";
  return key.name.startsWith("deploy_") || /deploy/i.test(key.comment);
}

// The one platform a key is for: its mark's "for <host>", else where its remotes all go, else
// a comment ending "for <host>" — what its own Test starts with.
export function keyHost(key: SshKeyInfo, uses: KeyUse[] | null): string | undefined {
  const label = keyLabel(key.comment);
  if (label?.kind === "for") return label.host;
  const hosts = [...new Set((uses ?? []).map((u) => u.hostname))];
  return hosts.length === 1 ? hosts[0] : /\bfor ([A-Za-z0-9._-]+)$/.exec(key.comment)?.[1];
}

// Which list a key is in, and the word beside its name — by its mark when it has one, else
// as far as its name, comment and remotes say: a deploy key, on one repository (that
// repository, or the project its mark names); an account key — ssh's own, which it offers
// wherever no other is named, or one for a platform — on your account (the platform, when
// one); a key for logging in to other computers; or none of these.
export function keyGroup(
  key: SshKeyInfo,
  uses: KeyUse[] | null,
): { group: "account" | "deploy" | "login" | "other"; tag: string | null } {
  const label = keyLabel(key.comment);
  if (label?.kind === "login") return { group: "login", tag: null };
  if (isDeploy(key)) {
    const repos = [...new Set((uses ?? []).map((u) => webOf(u.url, u.hostname)?.replace(/^https?:\/\/[^/]+\//, "")))];
    const repo = repos.length === 1 ? (repos[0] ?? null) : null;
    return { group: "deploy", tag: repo ?? (label?.kind === "deploy" ? label.project : null) };
  }
  const host = keyHost(key, uses) ?? null;
  // ssh's own, unlabelled, is git's only where a remote uses it (or the line is too old to
  // say): otherwise it is anyone's — a login, as likely as not.
  const gits = keyKind(key.name) === "account" && (uses == null || uses.length > 0);
  return label || host || gits ? { group: "account", tag: host } : { group: "other", tag: null };
}

// What a key is, by its name: ssh's own (`id_…`) the account key, which it offers wherever
// no other is named; Git's Own key makes `deploy_<project>`; anything else git doesn't use
// unless ~/.ssh/config names it.
export function keyKind(name: string): "account" | "deploy" | "other" {
  return name.startsWith("id_") ? "account" : name.startsWith("deploy_") ? "deploy" : "other";
}

// The host an SSH remote names — `git@host:path`, `ssh://user@host:port/path` — or null
// for another transport: as the overview and Git's Test find it.
export function sshHost(url: string): string | null {
  const m = /^ssh:\/\/(?:[^@/]*@)?([^/:]+)/.exec(url) ?? (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? null : /^[^@/:]*@([^:/]+):/.exec(url));
  return m ? m[1] : null;
}

// Where a key is used: each remote — of a project, or a submodule of one — whose key it is,
// its project's own (Own key), else what ssh offers the remote's host. Null where the
// status line is too old to say.
export interface KeyUse {
  repo: string; // the project's path in the home folder
  module: string; // the submodule's, or ""
  way: "fetch" | "push" | "fetch and push";
  url: string;
  host: string;
  hostname: string; // where the host goes: an alias's HostName
  // One of several keys ssh tries on that host (no IdentitiesOnly, no project key of its
  // own): which gets in, only Test key on the host can say.
  offered: boolean;
}

export function keyUses(facts: Facts): Map<string, KeyUse[]> | null {
  if (!facts.remotes || !facts.ssh_hosts) return null;
  const uses = new Map<string, KeyUse[]>();
  const own = new Map((facts.projects ?? []).map((p) => [p.path, p.key]));
  // A remote with a pushurl fetches from its url and pushes to the other: that remote's
  // alone (from v15; before, the name wasn't sent, so any in the repository).
  const remoteOf = (r: { path: string; module: string; remote?: string }) => `${r.path}|${r.module}|${r.remote ?? ""}`;
  const pushes = new Set(facts.remotes.filter((r) => r.kind === "pushurl").map(remoteOf));
  // ssh names its default files whether they exist or not: only the keys there count.
  const here = new Set((facts.ssh_keys ?? []).map((k) => k.name));
  for (const r of facts.remotes) {
    const host = sshHost(r.url);
    if (!host) continue;
    const mine = r.module === "" ? own.get(r.path) : null;
    // A project's own command naming no key ("") says nothing of which key it uses.
    const keys = mine === "" ? [] : mine ? [mine] : (facts.ssh_hosts[host]?.keys ?? []).filter((k) => here.has(k));
    const offered = !mine && !facts.ssh_hosts[host]?.identities_only && keys.length > 1;
    const way = r.kind === "pushurl" ? "push" : pushes.has(remoteOf(r)) ? "fetch" : "fetch and push";
    for (const k of keys) {
      const use = { repo: r.path, module: r.module, way, url: r.url, host, hostname: facts.ssh_hosts[host]?.hostname ?? host, offered } as const;
      uses.set(k, [...(uses.get(k) ?? []), use]);
    }
  }
  return uses;
}

export interface Facts {
  ok: boolean;
  error?: string;
  old?: boolean; // its status line predates the overview: install again
  outdated?: boolean; // read, but its line is older than this Loskai's: install again for what changed
  checked: number;
  os?: string | null;
  os_id?: string | null;
  os_like?: string[];
  kernel?: string | null;
  uptime?: number | null; // seconds
  memory?: { total: number; available: number | null } | null; // bytes
  disks?: { mount: string; device: string; size: number; used: number }[]; // bytes
  updates?: { manager: string; count: number } | null;
  programs?: string[]; // what tools require (lib/tools.ts)
  // `tool`: the tool whose shared session it is (`claude-site` is Claude Code's), else null.
  tmux?: { name: string; created: number; attached: boolean; windows: number; tool: string | null }[];
  // By tool and kind, the rows whose shared session is running: { claude: { project: ["site"] } }.
  live?: Record<string, Record<string, string[]>>;
  tailscale?: string | null; // its Tailscale IPv4 address; null: not connected
  // The devices `tailscale status` lists, this machine first (`self`).
  tailnet?: { ip: string; name: string; os: string; online: boolean; self: boolean; status: string }[];
  // This machine on the tailnet: connected ("on"), "off", logged out ("login") or waiting
  // for the tailnet's admin ("approval"); the networks it shares, and those approved. null:
  // not known (no Tailscale, or a status line before v9).
  tailscale_self?: {
    state: "on" | "off" | "login" | "approval" | null;
    shared: string[];
    approved: string[];
  } | null;
  // The git repos in the home folder; `folder` relative to it, times in seconds (0: never).
  projects?: {
    path: string;
    folder: string;
    name: string;
    branch: string | null;
    dirty: boolean;
    claude: number;
    ahead: number | null; // commits not on its upstream yet; null without one
    committed: number;
    subject: string;
    // The SSH key git uses for it: null the machine's, a key's name its own (Git's Own key),
    // "" a core.sshCommand naming none.
    key?: string | null;
  }[];
  // The SSH user's keys in ~/.ssh, by their public halves; null from a line before v11.
  ssh_keys?: SshKeyInfo[] | null;
  // Every remote of each project and its submodules (`module` "" for the project itself),
  // no user or token in it; the keys ssh offers each SSH host they name; the keys
  // ~/.ssh/config names — the three null from a line before v12.
  // `remote` its name (`origin`), "" from a line before v15.
  remotes?: { path: string; module: string; remote?: string; kind: "url" | "pushurl"; url: string }[] | null;
  ssh_hosts?: Record<string, { hostname: string; identities_only: boolean; keys: string[] }> | null;
  ssh_config_keys?: string[] | null;
  // An ssh config with `Match exec`: ssh would run a command to answer, so ssh_hosts wasn't
  // asked (v14) — which keys the remotes use can't be told there.
  ssh_match_exec?: boolean;
  // Loskai's sudo rule — updates without a password; null where the machine won't say.
  sudo_rule?: "on" | "off" | null;
}

// A machine's overview: read again every minute where one machine is open (its dialog, a
// tool's) — the backend reuses an answer for 60 s. `poll: false` where every machine's is
// read at once (Projects, Update all): once as it opens, and again when a run there ends —
// the runner invalidates it — not each machine's heavier read every minute.
export function useFacts(machineId: string, enabled: boolean, poll = true) {
  return useQuery({ ...factsQuery(machineId, poll), enabled });
}

// The read behind `useFacts` — for reading several machines' at once (`useQueries`).
export function factsQuery(machineId: string, poll = true) {
  return {
    queryKey: ["ssh-facts", machineId],
    queryFn: () => api.get<Facts>(`/api/ssh/machines/${machineId}/facts`),
    refetchInterval: poll ? 60_000 : (false as const),
  };
}

// What Tailscale is doing on the machine: the line's own state (v9), or before it, whether
// it has an address.
export function tailscaleState(facts: Facts): "on" | "off" | "login" | "approval" {
  return facts.tailscale_self?.state ?? (facts.tailscale ? "on" : "off");
}

// Tailscale in a few words — its address, or what it waits for — for the overview and its card.
export function tailscaleStatus(facts: Facts): string {
  const state = tailscaleState(facts);
  if (state === "login") return "logged out";
  if (state === "approval") return "waiting for approval";
  return facts.tailscale ?? "not connected";
}

// A machine's own keys in a few words — "2 keys: 1 account, 1 deploy" — for its SSH settings.
export function keysSummary(facts: Facts): string {
  const keys = facts.ssh_keys ?? [];
  const uses = keyUses(facts);
  const counts = new Map<string, number>();
  for (const k of keys) {
    const { group } = keyGroup(k, uses ? (uses.get(k.name) ?? []) : null);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const parts = ["account", "deploy", "login", "other"].filter((g) => counts.get(g)).map((g) => `${counts.get(g)} ${g === "other" ? "unlabelled" : g}`);
  return `${keys.length} ${keys.length === 1 ? "key" : "keys"}${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

