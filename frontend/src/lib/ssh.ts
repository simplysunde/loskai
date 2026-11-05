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
}
// Whether the main key is unlocked now — for your account (the backend's `unlocked_until`).
export function keyUnlocked(key?: SshKey | null): boolean {
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
  projects: Record<string, string>; // each machine's projects folder: "~/projects", "~"
}

// Whether removing a machine, or its SSH connection, takes Loskai's things off it first — it is
// set up (its host key trusted) and there is a key — and so whether it needs your password
// while the key is locked. The backend's own test is `connect.removal`.
export function takesKeysOff(ssh: SshStatus | undefined, machineId: string): boolean {
  return Boolean(ssh?.key && ssh.trusted[machineId]);
}

export function removalNeedsPassword(ssh: SshStatus | undefined, machineId: string): boolean {
  return takesKeysOff(ssh, machineId) && !keyUnlocked(ssh?.key);
}

export function useSsh() {
  return useQuery({ queryKey: ["ssh"], queryFn: () => api.get<SshStatus>("/api/ssh") });
}

// What runs on a machine, read with the status key (works while the main key is locked).
export interface Running {
  ok: boolean;
  error?: string;
  checked: number; // epoch seconds
  containers?: { name: string; image: string; status: string }[];
  services?: string[];
  hidden?: number; // base-system services, counted not listed
  guests?: { id: string; name: string; kind: "lxc" | "vm" }[];
  denied?: string[]; // lists the SSH user may not read: docker, pct, qm
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
export interface Facts {
  ok: boolean;
  error?: string;
  old?: boolean; // its status line predates the overview: install again
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
  tmux?: { name: string; created: number; attached: boolean; windows: number }[];
  tailscale?: string | null; // its Tailscale IPv4 address; null: not connected
  // The devices `tailscale status` lists, this machine first (`self`).
  tailnet?: { ip: string; name: string; os: string; online: boolean; self: boolean; status: string }[];
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
  }[];
  // Loskai's sudo rule — updates without a password; null where the machine won't say.
  sudo_rule?: "on" | "off" | null;
}

// Only a machine's own page asks; the backend reuses an answer for 60 s.
export function useFacts(machineId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ssh-facts", machineId],
    queryFn: () => api.get<Facts>(`/api/ssh/machines/${machineId}/facts`),
    refetchInterval: 60_000,
    enabled,
  });
}
