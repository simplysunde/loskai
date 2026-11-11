import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

export type ModuleState = "healthy" | "degraded" | "unreachable" | "unconfigured";

// The host in AdGuard's answer IP — where Caddy listens, and its cert page with it — as it
// is written in a URL or before a port: an IPv6 address in brackets. The value is a bare
// IP, but an older setting may carry a scheme, a path or a port.
export function answerHost(answerIp?: string | null): string {
  const host = (answerIp ?? "").replace(/^\w+:\/\//, "").split("/")[0];
  const bracketed = host.match(/^\[([^\]]+)\]/);
  if (bracketed) return `[${bracketed[1]}]`;
  // More than one colon is an IPv6 address, not a host and a port.
  if ((host.match(/:/g) ?? []).length > 1) return `[${host}]`;
  return host.split(":")[0];
}

export interface ModuleHealth {
  status: ModuleState;
  detail?: string;
  mode?: "docker" | "lan" | null; // caddy
  stacks_dir_ok?: boolean; // docker
  answer_ip?: string | null; // adguard — the shared Caddy IP rewrites resolve to
  url?: string | null; // adguard + wireguard — base URL for the link-out
  running?: boolean; // adguard
  version?: string | null; // adguard
  reachable?: boolean; // wireguard
  dns_hint?: string | null; // wireguard — AdGuard IP for peer DNS
}

export type ModuleName = "caddy" | "adguard" | "wireguard" | "docker";

export interface ConsistencyWarning {
  id: string;
  domain: string;
  kind: "dns_missing" | "dns_conflict";
  // On the Machines tab rather than Routing.
  machine?: boolean;
  detail: string;
}

export type HealthMap = Record<ModuleName, ModuleHealth> & {
  consistency?: ConsistencyWarning[];
};

// Polls the aggregate health every 30s (docs/project/architecture.md: one poll, all modules, no reload on a
// single module going down). Disabled when logged out — /api/health is gated, so
// polling it unauthenticated would 401-redirect the public dashboard. It goes on in a
// background tab too: each poll renews the session, so an open page keeps it, as
// Proxmox's does.
export function useHealth(enabled = true) {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<HealthMap>("/api/health"),
    refetchInterval: enabled ? 30_000 : false,
    refetchIntervalInBackground: true,
    enabled,
  });
}

// Whether Caddy is set up. Loskai runs without it — Docker, Machines, and links on the
// Dashboard — and then nothing offers a route it can't make; links are offered instead.
// Unknown (the health poll not back yet) counts as set up, which is what most installs are.
export function useCaddySetUp(): boolean {
  return useHealth().data?.caddy?.status !== "unconfigured";
}
