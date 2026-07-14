import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

export type ModuleState = "healthy" | "degraded" | "unreachable" | "unconfigured";

export interface ModuleHealth {
  status: ModuleState;
  detail?: string;
  mode?: "docker" | "lan" | null; // caddy
  stacks_dir_ok?: boolean; // docker
  answer_ip?: string | null; // adguard — the shared Caddy IP rewrites resolve to
  url?: string | null; // adguard — base URL for the link-out
  running?: boolean; // adguard
  version?: string | null; // adguard
}

export type ModuleName = "caddy" | "adguard" | "wireguard" | "docker";
export type HealthMap = Record<ModuleName, ModuleHealth>;

// Polls the aggregate health every 30s (PLAN: one poll, all modules, no reload on a
// single module going down). Disabled when logged out — /api/health is gated, so
// polling it unauthenticated would 401-redirect the public dashboard.
export function useHealth(enabled = true) {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<HealthMap>("/api/health"),
    refetchInterval: enabled ? 30_000 : false,
    enabled,
  });
}
