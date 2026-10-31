import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

// Loskai's SSH key (null until one is made) and each Host in its SSH config, by alias — a
// machine's entry is the one named after its hostname.
export interface SshKey {
  public_key: string;
  authorized_keys: string; // the main key's line, with from= when it is known
  lines: string[]; // both lines a machine gets: the main key's, then the status key's
  from: string | null; // the Docker host's IP the keys are limited to
  unlocked_until: string | null; // when the main key locks again; null while locked
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
