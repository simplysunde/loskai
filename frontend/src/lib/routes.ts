import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import type { RouteRow } from "../components/routing/ServiceTable";

// GET /api/adguard/status: whether each routed name's rewrite is there, by instance id.
export interface DnsStatus {
  answer_ip: string | null;
  instances: { id: string; domain: string; present: boolean | null; conflict: boolean }[];
}

// Every record, routed or not — one cache entry for the Routing and Machines tabs, a
// machine's dialog and the Add route picker.
export function useRoutes(enabled = true) {
  return useQuery({
    queryKey: ["caddy-routes"],
    queryFn: () => api.get<RouteRow[]>("/api/caddy/routes"),
    refetchInterval: 15_000,
    enabled,
  });
}

// The routes with each row's DNS status merged in, and the built-in network services
// already routed (the Add route picker's Network source leaves those out).
export function useRouteRows() {
  const routes = useRoutes();
  const dns = useQuery({
    queryKey: ["adguard-status"],
    queryFn: () => api.get<DnsStatus>("/api/adguard/status"),
    refetchInterval: 15_000,
  });
  const dnsById = new Map(dns.data?.instances.map((i) => [i.id, i]) ?? []);
  const rows: RouteRow[] = (routes.data ?? []).map((r) => {
    const d = dnsById.get(r.id);
    return { ...r, dnsPresent: d?.present ?? null, dnsConflict: d?.conflict ?? false };
  });
  const routedOrigins = new Set(rows.filter((r) => r.origin && r.routed).map((r) => r.origin as string));
  return { routes, rows, routedOrigins };
}

// AdGuard answers the name with the right address and nothing else — a phone shows the DNS
// status only when this is false.
export function dnsFine(row: { dnsPresent?: boolean | null; dnsConflict?: boolean }) {
  return row.dnsPresent === true && !row.dnsConflict;
}
