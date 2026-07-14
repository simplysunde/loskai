import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, UploadCloud } from "lucide-react";

import { api } from "../lib/api";
import { useHealth } from "../lib/useHealth";
import { CaddyfileExport } from "../components/routing/CaddyfileExport";
import { ServiceTable, type RouteRow } from "../components/routing/ServiceTable";
import { ModuleStatus } from "../components/shared/ModuleStatus";

// Unified routing view. In Phase 3 this is read + Push all + Caddyfile export; the
// AdGuard DNS column (Phase 4) and the Assign/delete actions (Phase 6) fold in later.
export function Routing() {
  const qc = useQueryClient();
  const health = useHealth();
  const routes = useQuery({
    queryKey: ["caddy-routes"],
    queryFn: () => api.get<RouteRow[]>("/api/caddy/routes"),
    refetchInterval: 15_000,
  });

  const push = useMutation({
    mutationFn: () =>
      api.post<{ pushed: { id: string; status: string }[] }>("/api/caddy/push"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["caddy-routes"] }),
  });

  const pushResult = push.data?.pushed;
  const pushErrors = pushResult?.filter((r) => r.status !== "ok").length ?? 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Routing</h1>
          <p className="mt-1 text-sm text-slate-500">
            Caddy routes for your services. DNS rewrites arrive with the AdGuard module.
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

      <div className="mb-4 space-y-2">
        <ModuleStatus name="Caddy" health={health.data?.caddy} />
        {pushResult && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              pushErrors
                ? "border-amber-600/40 bg-amber-500/10 text-amber-200"
                : "border-emerald-600/40 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            Pushed {pushResult.length} route{pushResult.length === 1 ? "" : "s"}
            {pushErrors ? ` — ${pushErrors} failed` : ""}.
          </div>
        )}
      </div>

      {routes.isLoading ? (
        <div className="flex justify-center py-16 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <ServiceTable rows={routes.data ?? []} />
      )}

      <div className="mt-6">
        <CaddyfileExport />
      </div>
    </div>
  );
}
