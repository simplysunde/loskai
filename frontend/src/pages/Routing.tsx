import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus, Trash2, Unplug, UploadCloud } from "lucide-react";

import { api, ApiError } from "../lib/api";
import { useHealth } from "../lib/useHealth";
import { AdGuardStatus } from "../components/routing/AdGuardStatus";
import { AssignModal } from "../components/routing/AssignModal";
import { CaddyfileExport } from "../components/routing/CaddyfileExport";
import { ServiceTable, type RouteRow } from "../components/routing/ServiceTable";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { ModuleStatus } from "../components/shared/ModuleStatus";

interface DnsStatus {
  answer_ip: string | null;
  instances: { id: string; domain: string; present: boolean | null; conflict: boolean }[];
}
interface Orphan {
  id: string;
  name: string;
  container: string | null;
  subdomain: string | null;
}
interface SettingsView {
  base_domain?: { value: string | null };
}
interface AssignResult {
  caddy: string;
  adguard: string;
  url: string;
  warning: string | null;
}

// Unified routing view. Lists every instance (routed or not). Routed rows manage the
// Caddy route + DNS rewrite; unrouted rows can be assigned. External instances can be
// deleted outright; docker instances (container-backed) can only have their route removed.
export function Routing() {
  const qc = useQueryClient();
  const health = useHealth();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<RouteRow | null>(null); // null = new instance
  const [assignError, setAssignError] = useState<string | null>(null);
  const [result, setResult] = useState<AssignResult | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<RouteRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RouteRow | null>(null);

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
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsView>("/api/settings"),
  });
  const orphans = useQuery({
    queryKey: ["docker-orphans"],
    queryFn: () => api.get<Orphan[]>("/api/docker/orphans"),
    refetchInterval: 30_000,
  });

  const baseDomain = settings.data?.base_domain?.value ?? null;
  const mode = health.data?.caddy?.mode ?? null;
  const answerIp = dns.data?.answer_ip ?? null;
  const consistency = health.data?.consistency ?? [];

  const dnsById = new Map(dns.data?.instances.map((i) => [i.id, i]) ?? []);
  const rows: RouteRow[] = (routes.data ?? []).map((r) => {
    const d = dnsById.get(r.id);
    return { ...r, dnsPresent: d?.present ?? null, dnsConflict: d?.conflict ?? false };
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["caddy-routes"] });
    qc.invalidateQueries({ queryKey: ["adguard-status"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["docker-orphans"] });
  };

  const cleanupOrphan = useMutation({
    mutationFn: (o: Orphan) => api.del(`/api/docker/orphans/${o.id}`),
    onSuccess: invalidate,
    onError: (err) => setAssignError(err instanceof ApiError ? err.message : "Cleanup failed"),
  });

  const assign = useMutation({
    mutationFn: (p: { prefix: string; upstream: string; upstream_tls: boolean }) =>
      api.post<AssignResult>("/api/assign", { ...p, instance_id: assignTarget?.id ?? undefined }),
    onSuccess: (data) => {
      setAssignOpen(false);
      setResult(data);
      invalidate();
    },
    onError: (err) => setAssignError(err instanceof ApiError ? err.message : "Assign failed"),
  });

  // Remove the route (Caddy + DNS), keep the instance.
  const removeRoute = useMutation({
    mutationFn: (row: RouteRow) => api.del(`/api/assign/${row.id}`),
    onSuccess: () => {
      setConfirmRemove(null);
      invalidate();
    },
  });

  // Delete an external instance entirely (docker instances 409 on the backend).
  const deleteInstance = useMutation({
    mutationFn: (row: RouteRow) => api.del(`/api/instances/${row.id}`),
    onSuccess: () => {
      setConfirmDelete(null);
      invalidate();
    },
    onError: (err) => setAssignError(err instanceof ApiError ? err.message : "Delete failed"),
  });

  const privateToggle = useMutation({
    mutationFn: (row: RouteRow) => api.patch(`/api/instances/${row.id}`, { private: !row.private }),
    onSuccess: invalidate,
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

  const push = useMutation({
    mutationFn: async () => {
      const [caddy, adguard] = await Promise.allSettled([
        api.post<{ pushed: { status: string }[] }>("/api/caddy/push"),
        api.post<{ added: string[]; deleted: string[]; conflicts: unknown[]; errors: unknown[] }>(
          "/api/adguard/reconcile",
        ),
      ]);
      return { caddy, adguard };
    },
    onSuccess: invalidate,
  });

  const openAssign = (target: RouteRow | null) => {
    setAssignTarget(target);
    setAssignError(null);
    setAssignOpen(true);
  };
  const actionBusyId = removeRoute.isPending
    ? removeRoute.variables?.id
    : deleteInstance.isPending
      ? deleteInstance.variables?.id
      : null;

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
            onClick={() => openAssign(null)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" /> Assign URL
          </button>
          <button
            onClick={() => push.mutate()}
            disabled={push.isPending}
            title="Push Caddy routes + reconcile AdGuard rewrites"
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {push.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Push all
          </button>
        </div>
      </header>

      <div className="mb-4 space-y-3">
        <AdGuardStatus health={health.data?.adguard} />
        <ModuleStatus name="Caddy" health={health.data?.caddy} />
        {consistency.length > 0 && (
          <div className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-4 w-4" />
              {consistency.length} DNS {consistency.length === 1 ? "warning" : "warnings"}
            </div>
            <ul className="list-disc space-y-0.5 pl-5 text-amber-200/90">
              {consistency.map((w) => (
                <li key={`${w.id}:${w.kind}`}>{w.detail}</li>
              ))}
            </ul>
          </div>
        )}
        {(orphans.data?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-rose-600/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            <div className="mb-2 flex items-center gap-1.5 font-medium">
              <Unplug className="h-4 w-4" />
              {orphans.data!.length} orphaned{" "}
              {orphans.data!.length === 1 ? "route" : "routes"} — the container was removed
            </div>
            <ul className="space-y-1">
              {orphans.data!.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-medium text-rose-100">{o.name}</span>
                    <span className="text-rose-300/80">
                      {" "}
                      → {o.container}
                      {o.subdomain ? ` (${o.subdomain})` : ""}
                    </span>
                  </span>
                  <button
                    onClick={() => cleanupOrphan.mutate(o)}
                    disabled={cleanupOrphan.isPending}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-rose-500/50 px-2 py-1 text-xs text-rose-100 hover:bg-rose-500/20 disabled:opacity-50"
                  >
                    {cleanupOrphan.isPending && cleanupOrphan.variables?.id === o.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {result && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              result.warning
                ? "border-amber-600/40 bg-amber-500/10 text-amber-200"
                : "border-emerald-600/40 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            <span className="font-medium">{result.url}</span> —{" "}
            {result.warning ?? "route + DNS rewrite created."}
          </div>
        )}
      </div>

      {routes.isLoading ? (
        <div className="flex justify-center py-16 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <ServiceTable
          rows={rows}
          onAssign={(row) => openAssign(row)}
          onRemoveRoute={(row) => setConfirmRemove(row)}
          onDelete={(row) => setConfirmDelete(row)}
          actionBusyId={actionBusyId}
          onToggleRewrite={(row) => rewrite.mutate(row)}
          rewriteBusyId={rewrite.isPending ? rewrite.variables?.id : null}
          onTogglePrivate={(row) => privateToggle.mutate(row)}
          privateBusyId={privateToggle.isPending ? privateToggle.variables?.id : null}
        />
      )}

      <div className="mt-6">
        <CaddyfileExport />
      </div>

      <AssignModal
        key={`${assignTarget?.id ?? "new"}:${assignOpen}`}
        open={assignOpen}
        baseDomain={baseDomain}
        mode={mode}
        pending={assign.isPending}
        error={assignError}
        initialPrefix={assignTarget ? (assignTarget.subdomain ?? assignTarget.id) : ""}
        initialUpstream={assignTarget?.upstream ?? ""}
        initialTls={assignTarget?.upstream_tls ?? false}
        onSubmit={(p) => assign.mutate(p)}
        onClose={() => setAssignOpen(false)}
      />

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove route"
        destructive
        confirmLabel="Remove route"
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => confirmRemove && removeRoute.mutate(confirmRemove)}
      >
        This removes the Caddy route and AdGuard rewrite for{" "}
        <span className="font-medium text-slate-200">{confirmRemove?.fqdn}</span>. The
        instance is kept — you can re-assign it later.
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete instance"
        destructive
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteInstance.mutate(confirmDelete)}
      >
        This deletes{" "}
        <span className="font-medium text-slate-200">{confirmDelete?.name}</span> entirely,
        including its route and DNS rewrite. The service it points to isn't affected.
      </ConfirmDialog>
    </div>
  );
}
