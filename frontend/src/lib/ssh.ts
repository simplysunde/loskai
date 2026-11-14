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
}

// What a key is, by its name: ssh's own (`id_…`) the account key, which it offers wherever
// no other is named; Git's Own key makes `deploy_<project>`; anything else git doesn't use
// unless ~/.ssh/config names it.
export function keyKind(name: string): "account" | "deploy" | "other" {
  return name.startsWith("id_") ? "account" : name.startsWith("deploy_") ? "deploy" : "other";
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
  // Loskai's sudo rule — updates without a password; null where the machine won't say.
  sudo_rule?: "on" | "off" | null;
}

// Only a machine's own page asks; the backend reuses an answer for 60 s.
export function useFacts(machineId: string, enabled: boolean) {
  return useQuery({ ...factsQuery(machineId), enabled });
}

// The read behind `useFacts` — for reading several machines' at once (`useQueries`).
export function factsQuery(machineId: string) {
  return {
    queryKey: ["ssh-facts", machineId],
    queryFn: () => api.get<Facts>(`/api/ssh/machines/${machineId}/facts`),
    refetchInterval: 60_000,
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
