import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { HardDrive, Loader2 } from "lucide-react";

import { api, ApiError } from "../lib/api";
import type { SettingsView } from "../lib/settings";
import { useRunning, useSsh } from "../lib/ssh";
import { useHealth } from "../lib/useHealth";
import { AddMachineModal } from "../components/routing/AddMachineModal";
import { AddRouteModal, type NewRoute } from "../components/routing/AddRouteModal";
import { isMachine, routesOn } from "../components/routing/machine";
import { MachineTable } from "../components/routing/MachineTable";
import { MachineTerminal } from "../components/routing/MachineTerminal";
import { SaveBanner } from "../components/routing/SaveBanner";
import type { RouteRow } from "../components/routing/ServiceTable";
import { useSaveMachine, type SaveResult } from "../components/routing/useSaveMachine";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import type { MachineState } from "./Machine";

interface DnsStatus {
  answer_ip: string | null;
  instances: { id: string; domain: string; present: boolean | null; conflict: boolean }[];
}

// Named LAN machines: a name that resolves to an address, and nothing more — no route, no
// certificate. Every route on a machine's address is on it, so moving it here re-points them all.
// The records are the same instances Routing reads (`kind: "machine"`), from the same
// endpoint; this tab is a reading of that one store, not a second one.
export function Machines() {
  const qc = useQueryClient();
  const health = useHealth();
  const navigate = useNavigate();
  // Naming a machine; editing one is on its own page.
  const [naming, setNaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RouteRow | null>(null);
  // The machine a new route is being added on, from its row.
  const [routeOn, setRouteOn] = useState<RouteRow | null>(null);
  // The machine with a terminal open.
  const [terminalFor, setTerminalFor] = useState<RouteRow | null>(null);

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
  const ssh = useSsh();
  const sshHosts = ssh.data?.hosts ?? {};
  const trusted = ssh.data?.trusted ?? {};
  const running = useRunning(Object.keys(trusted).length > 0);

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
    qc.invalidateQueries({ queryKey: ["ssh"] });
    qc.invalidateQueries({ queryKey: ["ssh-running"] });
  };

  // A machine just named opens on its own page — and setting SSH up is part of naming
  // one, so given a user, its setup opens there next.
  const save = useSaveMachine({
    onSaved: (data, m) => {
      setNaming(false);
      const state: MachineState = { result: data, setup: Boolean(m.ssh) };
      navigate(`/machines/${data.instance_id}`, { state });
    },
    onError: setError,
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

  const deleting = confirmDelete ? routesOn(confirmDelete, rows) : [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Machines</h1>
          <p className="mt-1 text-sm text-slate-500">
            Machines on your network, each with its DNS name and the routes it hosts.
          </p>
        </div>
        <button
          onClick={() => {
            setError(null);
            setNaming(true);
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500"
        >
          <HardDrive className="h-4 w-4" /> Name a machine
        </button>
      </header>

      {/* AdGuard's status is Routing's to show, beside Caddy's; each machine's own DNS
          state is in its row. */}
      {result && <SaveBanner result={result} />}

      {routes.isLoading ? (
        <div className="flex justify-center py-16 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <MachineTable
          machines={machines}
          rows={rows}
          ssh={sshHosts}
          trusted={trusted}
          running={running.data ?? {}}
          onOpen={(m) => navigate(`/machines/${m.id}`)}
          onTerminal={setTerminalFor}
          onDelete={setConfirmDelete}
          onAddRoute={(m) => {
            setError(null);
            setRouteOn(m);
          }}
          busyId={remove.isPending ? remove.variables?.id : null}
        />
      )}

      <AddMachineModal
        key={String(naming)}
        open={naming}
        baseDomain={baseDomain}
        pending={save.isPending}
        error={error}
        onSubmit={(m) => save.mutate(m)}
        onClose={() => setNaming(false)}
      />

      <AddRouteModal
        key={routeOn?.id ?? "route-closed"}
        open={routeOn !== null}
        baseDomain={baseDomain}
        mode={health.data?.caddy?.mode ?? null}
        initialMachine={routeOn ? { address: routeOn.upstream ?? "" } : undefined}
        pending={addRoute.isPending}
        error={error}
        routedOrigins={routedOrigins}
        onSubmit={(r) => addRoute.mutate(r)}
        onClose={() => setRouteOn(null)}
      />

      {terminalFor && (
        <MachineTerminal
          key={terminalFor.id}
          machine={{ id: terminalFor.id, name: terminalFor.name }}
          sshKey={ssh.data?.key ?? null}
          onClose={() => setTerminalFor(null)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete machine"
        destructive
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove.mutate(confirmDelete)}
      >
        This deletes <span className="font-medium text-slate-200">{confirmDelete?.name}</span>{" "}
        and its DNS rewrite{confirmDelete?.subdomain && sshHosts[confirmDelete.subdomain] ? " and SSH entry" : ""}.
        The machine itself isn't affected.
        {/* Deleting a machine doesn't break what runs on it: nothing links those routes,
            so they keep the address they already have. */}
        {deleting.length > 0 && (
          <span className="mt-2 block text-amber-300">
            {deleting.length === 1 ? "1 route is" : `${deleting.length} routes are`} on its
            address ({deleting.map((r) => r.name).join(", ")}). They keep it and go on working.
          </span>
        )}
      </ConfirmDialog>
    </div>
  );
}
