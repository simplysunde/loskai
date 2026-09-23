import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Copy,
  HardDrive,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Unplug,
} from "lucide-react";

import { api, ApiError } from "../lib/api";
import type { SettingsView } from "../lib/settings";
import { useHealth } from "../lib/useHealth";
import { AddMachineModal, type NewMachine } from "../components/routing/AddMachineModal";
import { AddRouteModal, type NewRoute } from "../components/routing/AddRouteModal";
import { AssignModal } from "../components/routing/AssignModal";
import { InfraStatusPill } from "../components/routing/InfraStatusPill";
import { ServiceTable, type RouteRow } from "../components/routing/ServiceTable";
import { applyView, isMachine, ViewFilter, type View } from "../components/routing/ViewFilter";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";

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
interface AssignResult {
  caddy: string;
  adguard: string;
  url: string;
  warning: string | null;
}

// Unified routing view. Lists every instance (routed or not). Routed rows manage the
// Caddy route + DNS rewrite; per-row "Change URL" edits an existing route. Any instance can
// be removed (route only) or deleted (route + record) — deleting a docker instance leaves
// its container alone. New routes are created via the "Add route" picker.
export function Routing() {
  const qc = useQueryClient();
  const health = useHealth();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<RouteRow | null>(null); // for editing an existing route
  // Two verbs, one surface: "Add route" publishes a service, "Name a machine" records an
  // address others can point at. Both open the same picker — the second just starts on the
  // External + DNS-only form — so route creation stays consolidated.
  const [addOpen, setAddOpen] = useState<null | "route" | "machine">(null);
  // Machines and services share one table — "both" is the default, since the point of one
  // inventory is being able to see it. The other views are for when it gets long.
  const [view, setView] = useState<View>("all");
  // Re-pointing a machine opens the machine form, not the route form: a machine has no
  // port and no TLS, and its hostname may be dotted.
  const [machineTarget, setMachineTarget] = useState<RouteRow | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [result, setResult] = useState<AssignResult | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<RouteRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RouteRow | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);

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
  // Only for the upstream hint when editing a docker route: the container knows how Caddy
  // reaches it. Shares AddRouteModal's query key, so React Query serves both from one
  // fetch; `retry: false` keeps a down Docker daemon from blocking this page.
  const containers = useQuery({
    queryKey: ["docker-containers"],
    queryFn: () => api.get<{ name: string; upstream_mode?: "docker" | "lan" | null }[]>(
      "/api/docker/containers",
    ),
    retry: false,
  });

  const h = health.data;
  const baseDomain = settings.data?.base_domain?.value ?? null;
  const mode = h?.caddy?.mode ?? null;
  const consistency = h?.consistency ?? [];

  // The cert-onboarding page is served by Caddy over plain HTTP on :80 at its LAN IP —
  // deliberately by-IP and not behind the route, since its whole job is fixing the untrusted
  // -cert warning. AdGuard's answer IP *is* the Caddy host, so it's the one source for both.
  // Per-container where the row is a container, else the deployment-wide summary — the
  // Network-service and External rows have no container to ask.
  const assignMode =
    containers.data?.find((c) => c.name === assignTarget?.container)?.upstream_mode ?? mode;

  const caddyHost = (h?.adguard?.answer_ip ?? "")
    .replace(/^\w+:\/\//, "")
    .split("/")[0]
    .split(":")[0];
  const certUrl = caddyHost ? `http://${caddyHost}/` : null;
  const routedOrigins = new Set(
    (routes.data ?? []).filter((r) => r.origin && r.routed).map((r) => r.origin as string),
  );

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
    mutationFn: (p: {
      prefix: string;
      upstream: string;
      upstream_tls: boolean;
      machine?: string | null;
    }) =>
      api.post<AssignResult>("/api/routes", {
        ...p,
        instance_id: assignTarget?.id ?? undefined,
      }),
    onSuccess: (data) => {
      setAssignOpen(false);
      setResult(data);
      invalidate();
    },
    onError: (err) => setAssignError(err instanceof ApiError ? err.message : "Assign failed"),
  });

  // Create a route from the "Add route" picker (container / network service / external).
  const addRoute = useMutation({
    mutationFn: (r: NewRoute) => api.post<AssignResult>("/api/routes", r),
    onSuccess: (data) => {
      setAddOpen(null);
      setResult(data);
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
      invalidate();
    },
    onError: (err) => setAssignError(err instanceof ApiError ? err.message : "Add route failed"),
  });

  const saveMachine = useMutation({
    mutationFn: (m: NewMachine) => api.post<AssignResult>("/api/machines", m),
    onSuccess: (data) => {
      setAddOpen(null);
      setMachineTarget(null);
      setResult(data);
      invalidate();
    },
    onError: (err) => setAssignError(err instanceof ApiError ? err.message : "Save failed"),
  });

  // Remove the route (Caddy + DNS), keep the instance.
  const removeRoute = useMutation({
    mutationFn: (row: RouteRow) => api.del(`/api/assign/${row.id}`),
    onSuccess: () => {
      setConfirmRemove(null);
      invalidate();
    },
  });

  // Delete an instance entirely (route + rewrite + record) — any type.
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

  const push = useMutation({
    mutationFn: async () => {
      const [caddy, adguard] = await Promise.allSettled([
        api.post<{ pushed: { status: string }[] }>("/api/caddy/push"),
        api.post<{
          added: string[];
          deleted: string[];
          swept: string[];
          conflicts: unknown[];
          errors: unknown[];
        }>("/api/adguard/reconcile"),
      ]);
      return { caddy, adguard };
    },
    onSuccess: ({ adguard }) => {
      invalidate();
      const ag = adguard.status === "fulfilled" ? adguard.value : null;
      const swept = ag?.swept?.length ?? 0;
      setSyncNote(
        ag === null
          ? "Routes pushed. AdGuard was unreachable — DNS not reconciled."
          : swept > 0
            ? `Synced. Removed ${swept} orphaned DNS ${swept === 1 ? "rewrite" : "rewrites"}.`
            : "Synced.",
      );
      setTimeout(() => setSyncNote(null), 4000);
    },
  });

  // Routes hosted on a machine — read off the rows we already have, no extra request.
  const dependentsOf = (machine: RouteRow | null) =>
    machine ? rows.filter((r) => r.machine === machine.id) : [];

  // Change URL dispatches on what the row *is*: a machine's address is edited in the
  // machine form, a service's upstream in the route form.
  const openEdit = (row: RouteRow) => {
    setAssignError(null);
    if (isMachine(row)) {
      setMachineTarget(row);
      return;
    }
    openAssign(row);
  };

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
            onClick={() => {
              setAssignError(null);
              setAddOpen("machine");
            }}
            title="Record a LAN machine by address, so routes can point at it by name"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            <HardDrive className="h-4 w-4" /> Name a machine
          </button>
          <button
            onClick={() => {
              setAssignError(null);
              setAddOpen("route");
            }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" /> Add route
          </button>
          <button
            onClick={() => push.mutate()}
            disabled={push.isPending}
            title="Re-push every Caddy route and add any missing or stale AdGuard rewrites"
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {push.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync
          </button>
        </div>
      </header>

      <div className="mb-4 space-y-3">
        <InfraStatusPill
          icon={<Shield className="h-4 w-4" />}
          name="AdGuard"
          health={h?.adguard}
          url={h?.adguard?.url}
          linkLabel="Open AdGuard"
        >
          {h?.adguard?.answer_ip && (
            <span className="shrink-0 text-xs text-slate-500">
              answers → <span className="font-mono text-slate-400">{h.adguard.answer_ip}</span>
            </span>
          )}
        </InfraStatusPill>

        <InfraStatusPill
          icon={<Lock className="h-4 w-4" />}
          name="Caddy"
          health={h?.caddy}
          url={certUrl}
          linkLabel="Cert page"
          action={<CopyCertLink url={certUrl} />}
        >
          <span className="hidden shrink-0 text-xs text-slate-500 lg:inline">
            share the cert page to trust <span className="font-mono">*.{baseDomain ?? "domain"}</span>
          </span>
        </InfraStatusPill>
        {syncNote && (
          <div className="rounded-lg border border-teal-600/40 bg-teal-500/10 px-3 py-2 text-sm text-teal-200">
            {syncNote}
          </div>
        )}
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
            {/* `caddy: "skipped"` means a machine was named: there is no route, and
                saying there is was the one thing the banner got wrong. */}
            {result.warning ??
              (result.caddy === "skipped"
                ? "DNS rewrite created."
                : "route + DNS rewrite created.")}
          </div>
        )}
      </div>

      {routes.isLoading ? (
        <div className="flex justify-center py-16 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
        {rows.length > 0 && (
          <div className="mb-3">
            <ViewFilter
              view={view}
              onChange={setView}
              counts={{
                services: rows.filter((r) => !isMachine(r)).length,
                machines: rows.filter(isMachine).length,
              }}
            />
          </div>
        )}
        <ServiceTable
          rows={applyView(rows, view)}
          onAssign={(row) => openEdit(row)}
          onRemoveRoute={(row) => setConfirmRemove(row)}
          onDelete={(row) => setConfirmDelete(row)}
          actionBusyId={actionBusyId}
          onTogglePrivate={(row) => privateToggle.mutate(row)}
          privateBusyId={privateToggle.isPending ? privateToggle.variables?.id : null}
        />
        </>
      )}

      <AssignModal
        key={`${assignTarget?.id ?? "new"}:${assignOpen}`}
        open={assignOpen}
        baseDomain={baseDomain}
        mode={assignMode}
        pending={assign.isPending}
        error={assignError}
        initialPrefix={assignTarget ? (assignTarget.subdomain ?? assignTarget.id) : ""}
        initialUpstream={assignTarget?.upstream ?? ""}
        initialTls={assignTarget?.upstream_tls ?? false}
        initialMachine={assignTarget?.machine ?? null}
        rows={rows}
        onSubmit={(p) => assign.mutate(p)}
        onClose={() => setAssignOpen(false)}
      />

      <AddMachineModal
        key={machineTarget?.id ?? (addOpen === "machine" ? "new-machine" : "machine-closed")}
        open={addOpen === "machine" || machineTarget !== null}
        baseDomain={baseDomain}
        editing={
          machineTarget
            ? {
                id: machineTarget.id,
                hostname: machineTarget.subdomain ?? machineTarget.id,
                address: machineTarget.upstream ?? "",
                name: machineTarget.name,
              }
            : null
        }
        pending={saveMachine.isPending}
        error={assignError}
        onSubmit={(m) => saveMachine.mutate(m)}
        onClose={() => {
          setAddOpen(null);
          setMachineTarget(null);
        }}
      />

      <AddRouteModal
        key={addOpen ?? "add-closed"}
        open={addOpen === "route"}
        baseDomain={baseDomain}
        mode={mode}
        pending={addRoute.isPending}
        error={assignError}
        routedOrigins={routedOrigins}
        onSubmit={(r) => addRoute.mutate(r)}
        onClose={() => setAddOpen(null)}
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
        {/* Deleting a machine doesn't break what runs on it — those routes keep the
            address they already have. They just stop following it. */}
        {dependentsOf(confirmDelete).length > 0 && (
          <span className="mt-2 block text-amber-300">
            {dependentsOf(confirmDelete).length === 1 ? "1 route points" : `${dependentsOf(confirmDelete).length} routes point`}{" "}
            at this machine ({dependentsOf(confirmDelete).map((r) => r.name).join(", ")}).
            {" "}They keep its current address and go on working — they just stop following
            it when it moves.
          </span>
        )}
      </ConfirmDialog>
    </div>
  );
}

// Copy the by-IP cert-page URL — the thing you paste to a phone or TV when onboarding it
// onto the LAN, which is why this lives next to the link rather than in settings.
function CopyCertLink({ url }: { url: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!url) return null;

  return (
    <button
      type="button"
      title={`Copy ${url}`}
      onClick={() => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      <span className="sr-only">Copy cert page link</span>
    </button>
  );
}
