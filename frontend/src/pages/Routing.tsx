import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Copy,
  Link2,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Unplug,
} from "lucide-react";

import { api, apiMessage } from "../lib/api";
import { useMe } from "../lib/useAuth";
import { copyText } from "../lib/clipboard";
import type { SettingsView } from "../lib/settings";
import { useHealth } from "../lib/useHealth";
import { AddRouteModal, type NewRoute } from "../components/routing/AddRouteModal";
import { AssignModal } from "../components/routing/AssignModal";
import { containerPrefill, type PrefillSource } from "../components/routing/containerPrefill";
import { ICON_BUTTON, InfraStatusPill } from "../components/routing/InfraStatusPill";
import { NETWORK_SERVICES, urlToUpstream } from "../components/routing/networkServices";
import { ServiceTable, type RouteRow } from "../components/routing/ServiceTable";
import { isMachine } from "../components/routing/machine";
import { ActionError } from "../components/shared/ActionError";
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

// Unified routing view. Lists every service (routed or not) — machines have their own tab.
// Routed rows manage the Caddy route + DNS rewrite; per-row "Change URL" edits an existing
// route. Any service can be removed (route only) or deleted (route + record) — deleting a
// docker instance leaves its container alone. New routes are created via the "Add route"
// picker.
export function Routing() {
  const qc = useQueryClient();
  const { admin } = useMe();
  const health = useHealth();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<RouteRow | null>(null); // for editing an existing route
  const [addOpen, setAddOpen] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [result, setResult] = useState<AssignResult | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<RouteRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RouteRow | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  // A row action that failed (its dialogs say so themselves; these have none).
  const [failed, setFailed] = useState<{ title: string; detail: string } | null>(null);
  const reportsAs = (title: string) => ({
    onMutate: () => setFailed(null),
    onError: (err: unknown) => setFailed({ title, detail: apiMessage(err) }),
  });

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
  // The container behind a docker row knows how Caddy reaches it: the upstream hint, and
  // the pre-fill when the row has no upstream stored yet (a recipe install, linked but
  // never routed). Shares AddRouteModal's query key, so React Query serves both from one
  // fetch; `retry: false` keeps a down Docker daemon from blocking this page.
  const containers = useQuery({
    queryKey: ["docker-containers"],
    queryFn: () =>
      api.get<(PrefillSource & { upstream_mode?: "docker" | "lan" | null })[]>(
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
  const assignContainer = assignTarget?.container
    ? containers.data?.find((c) => c.name === assignTarget.container)
    : undefined;
  const assignMode = assignContainer?.upstream_mode ?? mode;
  // A container's route offers following. An existing route keeps whatever it declared; a
  // never-routed one (a fresh recipe install) starts out following whenever it can.
  const assignDerived = assignContainer?.suggested_upstream ?? null;
  const assignFollow = assignTarget?.container
    ? {
        initial: assignTarget.routed ? Boolean(assignTarget.follow_container) : Boolean(assignDerived),
        derived: assignDerived,
      }
    : undefined;

  const caddyHost = (h?.adguard?.answer_ip ?? "")
    .replace(/^\w+:\/\//, "")
    .split("/")[0]
    .split(":")[0];
  const certUrl = caddyHost ? `http://${caddyHost}/` : null;
  const routedOrigins = new Set(
    (routes.data ?? []).filter((r) => r.origin && r.routed).map((r) => r.origin as string),
  );

  // Once AdGuard is routed (from its pill or the picker — both set `origin`), its link-out
  // opens the name, not the address. Loskai itself still talks to AdGuard by its URL setting.
  const adguardRoute = (routes.data ?? []).find((r) => r.origin === "adguard" && r.fqdn);
  const adguardUrl = adguardRoute
    ? `${adguardRoute.scheme === "http" ? "http" : "https"}://${adguardRoute.fqdn}`
    : h?.adguard?.url;
  // What the pill shows beside its name: where its link goes, minus the scheme.
  const adguardAddress = adguardRoute?.fqdn ?? urlToUpstream(h?.adguard?.url);
  const adguardService = NETWORK_SERVICES.find((s) => s.origin === "adguard")!;
  const adguardUpstream = urlToUpstream(h?.adguard?.url);
  const canRouteAdguard =
    routes.isSuccess && !routedOrigins.has("adguard") && Boolean(adguardUpstream && baseDomain);

  const dnsById = new Map(dns.data?.instances.map((i) => [i.id, i]) ?? []);
  const allRows: RouteRow[] = (routes.data ?? []).map((r) => {
    const d = dnsById.get(r.id);
    return { ...r, dnsPresent: d?.present ?? null, dnsConflict: d?.conflict ?? false };
  });
  // Machines live on their own tab; the route forms still list them, and the table names them.
  const rows = allRows.filter((r) => !isMachine(r));
  const machines = allRows.filter(isMachine);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["caddy-routes"] });
    qc.invalidateQueries({ queryKey: ["adguard-status"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["docker-orphans"] });
  };

  const cleanupOrphan = useMutation({
    mutationFn: (o: Orphan) => api.del(`/api/docker/orphans/${o.id}`),
    onSuccess: invalidate,
    ...reportsAs("Couldn't delete the orphaned route"),
  });

  const assign = useMutation({
    mutationFn: (p: {
      prefix: string;
      upstream: string;
      upstream_tls: boolean;
      scheme?: "https" | "both" | "http";
      follow_container?: boolean;
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
    onError: (err) => setAssignError(apiMessage(err)),
  });

  // Create a route from the "Add route" picker (container / network service / external).
  const addRoute = useMutation({
    mutationFn: (r: NewRoute) => api.post<AssignResult>("/api/routes", r),
    onSuccess: (data) => {
      setAddOpen(false);
      setResult(data);
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
      invalidate();
    },
    onError: (err) => setAssignError(apiMessage(err)),
  });

  // AdGuard's pill routes it in one click — the same request the Add route picker's Network
  // source sends, so the instance carries `origin: "adguard"` either way.
  const routeAdguard = useMutation({
    mutationFn: (r: NewRoute) => api.post<AssignResult>("/api/routes", r),
    onSuccess: (data) => {
      setResult(data);
      invalidate();
    },
    ...reportsAs("Couldn't route AdGuard"),
  });

  const setIcon = useMutation({
    mutationFn: ({ row, file }: { row: RouteRow; file: File }) =>
      api.upload(`/api/instances/${row.id}/icon`, file),
    onSuccess: invalidate,
    ...reportsAs("Couldn't set the icon"),
  });

  const clearIcon = useMutation({
    mutationFn: (row: RouteRow) => api.del(`/api/instances/${row.id}/icon`),
    onSuccess: invalidate,
    ...reportsAs("Couldn't remove the icon"),
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
  });

  const privateToggle = useMutation({
    mutationFn: (row: RouteRow) => api.patch(`/api/instances/${row.id}`, { private: !row.private }),
    onSuccess: invalidate,
    ...reportsAs("Couldn't change who sees it"),
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
            Web addresses for your services — Caddy serves them, AdGuard points the names there.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => {
              setAssignError(null);
              setAddOpen(true);
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
        <div className="grid gap-3 md:grid-cols-2">
          <InfraStatusPill
            configurable={admin}
            icon={<Shield className="h-4 w-4" />}
            name="AdGuard"
            health={h?.adguard}
            url={adguardUrl}
            linkLabel={adguardRoute ? `Open AdGuard at ${adguardRoute.fqdn}` : "Open AdGuard"}
            action={
              canRouteAdguard && (
                <button
                  onClick={() =>
                    routeAdguard.mutate({
                      prefix: adguardService.prefix,
                      upstream: adguardUpstream,
                      upstream_tls: false,
                      scheme: "https",
                      origin: adguardService.origin,
                      name: adguardService.name,
                    })
                  }
                  disabled={routeAdguard.isPending}
                  title={`Route AdGuard at ${adguardService.prefix}.${baseDomain}`}
                  aria-label="Route AdGuard"
                  className={`${ICON_BUTTON} disabled:opacity-50`}
                >
                  {routeAdguard.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" />
                  )}
                </button>
              )
            }
          >
            {adguardAddress && (
              <span
                title={adguardRoute ? "AdGuard's route" : "AdGuard's URL, from Settings › Network"}
                className="min-w-0 truncate font-mono text-xs text-slate-500"
              >
                {adguardAddress}
              </span>
            )}
          </InfraStatusPill>

          <InfraStatusPill
            configurable={admin}
            icon={<Lock className="h-4 w-4" />}
            name="Caddy"
            health={h?.caddy}
            url={certUrl}
            linkLabel={`Cert page — share it to trust *.${baseDomain ?? "domain"}`}
            action={<CopyCertLink url={certUrl} />}
          >
            {h?.adguard?.answer_ip && (
              <span
                title="Where Caddy listens — every DNS rewrite answers with this address"
                className="min-w-0 truncate font-mono text-xs text-slate-500"
              >
                {h.adguard.answer_ip}
              </span>
            )}
          </InfraStatusPill>
        </div>
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
        {failed && <ActionError {...failed} onDismiss={() => setFailed(null)} />}
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
          rows={[...rows].sort((a, b) => a.name.localeCompare(b.name))}
          machines={machines}
          onAssign={(row) => openAssign(row)}
          onRemoveRoute={(row) => setConfirmRemove(row)}
          onDelete={(row) => setConfirmDelete(row)}
          actionBusyId={actionBusyId}
          onTogglePrivate={(row) => privateToggle.mutate(row)}
          onIcon={(row, file) => setIcon.mutate({ row, file })}
          onClearIcon={(row) => clearIcon.mutate(row)}
          privateBusyId={privateToggle.isPending ? privateToggle.variables?.id : null}
        />
      )}

      <AssignModal
        key={`${assignTarget?.id ?? "new"}:${assignOpen}`}
        open={assignOpen}
        baseDomain={baseDomain}
        mode={assignMode}
        pending={assign.isPending}
        error={assignError}
        initialPrefix={assignTarget ? (assignTarget.subdomain ?? assignTarget.id) : ""}
        initialUpstream={
          (assignFollow?.initial ? assignDerived : null) ??
          assignTarget?.upstream ??
          (assignContainer ? containerPrefill(assignContainer).upstream : "")
        }
        follow={assignFollow}
        dockerHost={settings.data?.host_ip?.value ?? null}
        containerHost={assignContainer?.suggested_host ?? null}
        initialTls={assignTarget?.upstream_tls ?? false}
        initialScheme={assignTarget?.scheme ?? "https"}
        rows={machines}
        onSubmit={(p) => assign.mutate(p)}
        onClose={() => setAssignOpen(false)}
      />

      <AddRouteModal
        key={String(addOpen)}
        open={addOpen}
        baseDomain={baseDomain}
        mode={mode}
        pending={addRoute.isPending}
        error={assignError}
        routedOrigins={routedOrigins}
        onSubmit={(r) => addRoute.mutate(r)}
        onClose={() => setAddOpen(false)}
      />

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove route"
        destructive
        confirmLabel="Remove route"
        pending={removeRoute.isPending}
        error={removeRoute.error && apiMessage(removeRoute.error)}
        onCancel={() => {
          setConfirmRemove(null);
          removeRoute.reset();
        }}
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
        pending={deleteInstance.isPending}
        error={deleteInstance.error && apiMessage(deleteInstance.error)}
        onCancel={() => {
          setConfirmDelete(null);
          deleteInstance.reset();
        }}
        onConfirm={() => confirmDelete && deleteInstance.mutate(confirmDelete)}
      >
        This deletes{" "}
        <span className="font-medium text-slate-200">{confirmDelete?.name}</span> entirely,
        including its route and DNS rewrite. The service it points to isn't affected.
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
      onClick={async () => {
        if (!(await copyText(url))) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={ICON_BUTTON}
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
