import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, UploadCloud } from "lucide-react";

import { api } from "../lib/api";
import { useHealth } from "../lib/useHealth";
import { AdGuardStatus } from "../components/routing/AdGuardStatus";
import { CaddyfileExport } from "../components/routing/CaddyfileExport";
import { ServiceTable, type RouteRow } from "../components/routing/ServiceTable";
import { ModuleStatus } from "../components/shared/ModuleStatus";

interface DnsStatus {
  answer_ip: string | null;
  instances: { id: string; domain: string; present: boolean | null; conflict: boolean }[];
}

// Unified routing view: Caddy routes + AdGuard DNS in one row per service. Push all
// runs the Caddy push and the AdGuard reconcile together. Assign/delete land in Phase 6.
export function Routing() {
  const qc = useQueryClient();
  const health = useHealth();

  const routes = useQuery({
    queryKey: ["caddy-routes"],
    queryFn: () => api.get<RouteRow[]>("/api/caddy/routes"),
    refetchInterval: 15_000,
  });
  const dns = useQuery({
    queryKey: ["adguard-status"],
    queryFn: () => api.get<DnsStatus>("/api/adguard/status"),
    refetchInterval: 15_000,
  });

  // Merge DNS status into each Caddy route row by instance id.
  const dnsById = new Map(dns.data?.instances.map((i) => [i.id, i]) ?? []);
  const rows: RouteRow[] = (routes.data ?? []).map((r) => {
    const d = dnsById.get(r.id);
    return { ...r, dnsPresent: d?.present ?? null, dnsConflict: d?.conflict ?? false };
  });
  const answerIp = dns.data?.answer_ip ?? null;

  const push = useMutation({
    mutationFn: async () => {
      const [caddy, adguard] = await Promise.allSettled([
        api.post<{ pushed: { id: string; status: string }[] }>("/api/caddy/push"),
        api.post<{ added: string[]; deleted: string[]; conflicts: unknown[]; errors: unknown[] }>(
          "/api/adguard/reconcile",
        ),
      ]);
      return { caddy, adguard };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["caddy-routes"] });
      qc.invalidateQueries({ queryKey: ["adguard-status"] });
    },
  });

  const rewrite = useMutation({
    mutationFn: (row: RouteRow) => {
      const body = { domain: row.fqdn, answer: answerIp };
      return row.dnsPresent
        ? api.del("/api/adguard/rewrites", body)
        : api.post("/api/adguard/rewrites", body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adguard-status"] }),
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Routing</h1>
          <p className="mt-1 text-sm text-slate-500">
            Caddy routes and AdGuard DNS rewrites, one row per service.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            disabled
            title="URL assignment lands in Phase 6 (cross-module assign endpoint)"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-500"
          >
            <Plus className="h-4 w-4" /> Assign URL
          </button>
          <button
            onClick={() => push.mutate()}
            disabled={push.isPending}
            title="Push Caddy routes + reconcile AdGuard rewrites"
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {push.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            Push all
          </button>
        </div>
      </header>

      <div className="mb-4 space-y-3">
        <AdGuardStatus health={health.data?.adguard} />
        <ModuleStatus name="Caddy" health={health.data?.caddy} />
        {push.data && <PushSummary result={push.data} />}
      </div>

      {routes.isLoading ? (
        <div className="flex justify-center py-16 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <ServiceTable
          rows={rows}
          onToggleRewrite={(row) => rewrite.mutate(row)}
          rewriteBusyId={rewrite.isPending ? rewrite.variables?.id : null}
        />
      )}

      <div className="mt-6">
        <CaddyfileExport />
      </div>
    </div>
  );
}

function PushSummary({
  result,
}: {
  result: {
    caddy: PromiseSettledResult<{ pushed: { status: string }[] }>;
    adguard: PromiseSettledResult<{ added: string[]; deleted: string[]; conflicts: unknown[]; errors: unknown[] }>;
  };
}) {
  const parts: string[] = [];
  if (result.caddy.status === "fulfilled") {
    const failed = result.caddy.value.pushed.filter((p) => p.status !== "ok").length;
    parts.push(`Caddy: ${result.caddy.value.pushed.length} pushed${failed ? `, ${failed} failed` : ""}`);
  } else {
    parts.push("Caddy: push failed");
  }
  if (result.adguard.status === "fulfilled") {
    const a = result.adguard.value;
    parts.push(
      `AdGuard: +${a.added.length} −${a.deleted.length}` +
        (a.conflicts.length ? `, ${a.conflicts.length} conflict(s)` : "") +
        (a.errors.length ? `, ${a.errors.length} error(s)` : ""),
    );
  } else {
    parts.push("AdGuard: reconcile failed (unreachable or no answer IP)");
  }
  const bad =
    result.caddy.status === "rejected" || result.adguard.status === "rejected";
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm ${
        bad
          ? "border-amber-600/40 bg-amber-500/10 text-amber-200"
          : "border-emerald-600/40 bg-emerald-500/10 text-emerald-200"
      }`}
    >
      {parts.join(" · ")}
    </div>
  );
}
