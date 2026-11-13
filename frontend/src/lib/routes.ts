import { useQuery, type QueryClient } from "@tanstack/react-query";

import { api } from "./api";
import type { NewLink, NewRoute } from "../components/routing/AddRouteModal";
import type { RouteRow } from "../components/routing/ServiceTable";
import type { SaveResult } from "../components/routing/useSaveMachine";

// Add route's submit, to the endpoint for what it made: a route goes through Caddy and
// AdGuard (/api/routes), a link is only saved (/api/links).
export function saveNew(r: NewRoute | NewLink) {
  if ("kind" in r) {
    const { kind: _kind, ...link } = r;
    return api.post<SaveResult>("/api/links", link);
  }
  return api.post<SaveResult>("/api/routes", r);
}

// What a change to the records makes stale: the record list (Routing, Machines, the
// pickers), the DNS column, the Dashboard, and the container rows' routes and links. One
// list, so every change refreshes every view of the records.
export function refreshRecords(qc: QueryClient) {
  for (const key of ["caddy-routes", "adguard-status", "dashboard", "docker-containers"]) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

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
// already routed (the Routing tab offers to route AdGuard while it isn't).
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
