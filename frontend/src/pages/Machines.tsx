import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardDrive, Loader2 } from "lucide-react";

import { api, ApiError } from "../lib/api";
import type { SettingsView } from "../lib/settings";
import { useHealth } from "../lib/useHealth";
import { AddMachineModal, type NewMachine } from "../components/routing/AddMachineModal";
import { AddRouteModal, type NewRoute } from "../components/routing/AddRouteModal";
import { dependentsOf, isMachine } from "../components/routing/machine";
import { MachineTable } from "../components/routing/MachineTable";
import type { RouteRow } from "../components/routing/ServiceTable";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";

interface DnsStatus {
  answer_ip: string | null;
  instances: { id: string; domain: string; present: boolean | null; conflict: boolean }[];
}
interface SaveResult {
  // "skipped" for a machine — it has no route.
  caddy: string;
  url: string;
  warning: string | null;
  relinked?: string[];
}

// Named LAN machines: a name that resolves to an address, and nothing more — no route, no
// certificate. Routes on the Routing tab link to one, so moving it here re-points them all.
// The records are the same instances Routing reads (`kind: "machine"`), from the same
// endpoint; this tab is a reading of that one store, not a second one.
export function Machines() {
  const qc = useQueryClient();
  const health = useHealth();
  // null: closed · "new": naming one · a row: editing that machine.
  const [editing, setEditing] = useState<RouteRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RouteRow | null>(null);
  // The machine a new route is being added on, from its row.
  const [routeOn, setRouteOn] = useState<RouteRow | null>(null);

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
  const baseDomain = settings.data?.base_domain?.value ?? null;

  const dnsById = new Map(dns.data?.instances.map((i) => [i.id, i]) ?? []);
  const rows: RouteRow[] = (routes.data ?? []).map((r) => {
    const d = dnsById.get(r.id);
    return { ...r, dnsPresent: d?.present ?? null, dnsConflict: d?.conflict ?? false };
  });
  const machines = rows.filter(isMachine);
  const routedOrigins = new Set(
    rows.filter((r) => r.origin && r.routed).map((r) => r.origin as string),
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["caddy-routes"] });
    qc.invalidateQueries({ queryKey: ["adguard-status"] });
  };

  const save = useMutation({
    mutationFn: (m: NewMachine) => api.post<SaveResult>("/api/machines", m),
    onSuccess: (data) => {
      setEditing(null);
      setResult(data);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Save failed"),
  });

  const addRoute = useMutation({
    mutationFn: (r: NewRoute) => api.post<SaveResult>("/api/routes", r),
    onSuccess: (data) => {
      setRouteOn(null);
      setResult(data);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Add route failed"),
  });

  const remove = useMutation({
    mutationFn: (row: RouteRow) => api.del(`/api/instances/${row.id}`),
    onSuccess: () => {
      setConfirmDelete(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Delete failed"),
  });

  const deleting = confirmDelete ? dependentsOf(confirmDelete.id, rows) : [];
  const target = editing !== "new" ? editing : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Machines</h1>
          <p className="mt-1 text-sm text-slate-500">
            LAN machines by name. Routes hosted on one follow it when its address changes.
          </p>
        </div>
        <button
          onClick={() => {
            setError(null);
            setEditing("new");
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500"
        >
          <HardDrive className="h-4 w-4" /> Name a machine
        </button>
      </header>

      {/* AdGuard's status is Routing's to show, beside Caddy's; each machine's own DNS
          state is in its row. */}
      {result && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            result.warning
              ? "border-amber-600/40 bg-amber-500/10 text-amber-200"
              : "border-emerald-600/40 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          <span className="font-medium">{result.url}</span> —{" "}
          {result.warning ?? (result.caddy === "skipped" ? "DNS rewrite saved." : "route + DNS rewrite created.")}
          {result.relinked && result.relinked.length > 0 && (
            <> Moved {result.relinked.join(", ")} with it.</>
          )}
        </div>
      )}

      {routes.isLoading ? (
        <div className="flex justify-center py-16 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <MachineTable
          machines={machines}
          rows={rows}
          onEdit={(m) => {
            setError(null);
            setEditing(m);
          }}
          onDelete={setConfirmDelete}
          onAddRoute={(m) => {
            setError(null);
            setRouteOn(m);
          }}
          busyId={remove.isPending ? remove.variables?.id : null}
        />
      )}

      <AddMachineModal
        key={target?.id ?? String(editing)}
        open={editing !== null}
        baseDomain={baseDomain}
        editing={
          target
            ? {
                id: target.id,
                hostname: target.subdomain ?? target.id,
                address: target.upstream ?? "",
                name: target.name,
              }
            : null
        }
        pending={save.isPending}
        error={error}
        onSubmit={(m) => save.mutate(m)}
        onClose={() => setEditing(null)}
      />

      <AddRouteModal
        key={routeOn?.id ?? "route-closed"}
        open={routeOn !== null}
        baseDomain={baseDomain}
        mode={health.data?.caddy?.mode ?? null}
        initialMachine={routeOn ? { id: routeOn.id, address: routeOn.upstream ?? "" } : undefined}
        pending={addRoute.isPending}
        error={error}
        routedOrigins={routedOrigins}
        onSubmit={(r) => addRoute.mutate(r)}
        onClose={() => setRouteOn(null)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete machine"
        destructive
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove.mutate(confirmDelete)}
      >
        This deletes <span className="font-medium text-slate-200">{confirmDelete?.name}</span>{" "}
        and its DNS rewrite. The machine itself isn't affected.
        {/* Deleting a machine doesn't break what runs on it — those routes keep the
            address they already have. They just stop following it. */}
        {deleting.length > 0 && (
          <span className="mt-2 block text-amber-300">
            {deleting.length === 1 ? "1 route points" : `${deleting.length} routes point`} at
            this machine ({deleting.map((r) => r.name).join(", ")}). They keep its current
            address and go on working — they just stop following it when it moves.
          </span>
        )}
      </ConfirmDialog>
    </div>
  );
}
