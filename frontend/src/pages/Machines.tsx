import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { HardDrive, Loader2 } from "lucide-react";

import { api, ApiError } from "../lib/api";
import type { SettingsView } from "../lib/settings";
import { useRunning, useSsh } from "../lib/ssh";
import { useTools, type ToolRun } from "../lib/tools";
import { useMe } from "../lib/useAuth";
import { useHealth } from "../lib/useHealth";
import { AddMachineModal } from "../components/routing/AddMachineModal";
import { AddRouteModal, type NewRoute } from "../components/routing/AddRouteModal";
import { isMachine, routesOn, unnamedDockerHost } from "../components/routing/machine";
import { MachineTable } from "../components/routing/MachineTable";
import { MachineTerminal } from "../components/routing/MachineTerminal";
import { SaveBanner } from "../components/routing/SaveBanner";
import { ToolDialog } from "../components/routing/ToolDialog";
import type { RouteRow } from "../components/routing/ServiceTable";
import { useSaveMachine, type SaveResult } from "../components/routing/useSaveMachine";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { MachineDialog, type MachineState } from "../components/routing/MachineDialog";

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
  const { may } = useMe();
  // The machine open in its dialog, from the cog on its row.
  const { id: openId, section } = useParams();
  // Naming a machine — the Docker host's address when named from its row; editing one is
  // in its dialog.
  const [naming, setNaming] = useState<{ address?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RouteRow | null>(null);
  // Deleting a set-up machine takes Loskai's key off it first, which needs the key unlocked:
  // your password, typed in the dialog when it is locked. What went wrong shows there;
  // a machine deleted with its key still on it says so after.
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null);
  // The machine a new route is being added on, from its row.
  const [routeOn, setRouteOn] = useState<RouteRow | null>(null);
  // The machine with a terminal open, and what it runs there — its shell, or System's Update.
  const [terminalFor, setTerminalFor] = useState<{ machine: RouteRow; run?: ToolRun } | null>(null);
  // A tool on a machine, from the Tools menu on its row.
  const [toolFor, setToolFor] = useState<{ machine: RouteRow; toolId: string } | null>(null);

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
  const tools = useTools();
  const sshHosts = ssh.data?.hosts ?? {};
  const trusted = ssh.data?.trusted ?? {};
  const running = useRunning(Object.keys(trusted).length > 0);

  const dnsById = new Map(dns.data?.instances.map((i) => [i.id, i]) ?? []);
  const rows: RouteRow[] = (routes.data ?? []).map((r) => {
    const d = dnsById.get(r.id);
    return { ...r, dnsPresent: d?.present ?? null, dnsConflict: d?.conflict ?? false };
  });
  const named = rows.filter(isMachine);
  const dockerHost = unnamedDockerHost(settings.data?.host_ip?.value, named);
  const machines = dockerHost ? [...named, dockerHost] : named;
  const routedOrigins = new Set(
    rows.filter((r) => r.origin && r.routed).map((r) => r.origin as string),
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["caddy-routes"] });
    qc.invalidateQueries({ queryKey: ["adguard-status"] });
    qc.invalidateQueries({ queryKey: ["ssh"] });
    qc.invalidateQueries({ queryKey: ["ssh-running"] });
  };

  // A machine just named opens in its dialog — and setting SSH up is part of naming
  // one, so given a user, its setup opens there next.
  const save = useSaveMachine({
    onSaved: (data, m) => {
      setNaming(null);
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

  const keyUnlocked = Boolean(
    ssh.data?.key?.unlocked_until && Date.parse(ssh.data.key.unlocked_until) > Date.now(),
  );
  const removesKeys = (row: RouteRow | null) => Boolean(row && ssh.data?.key && ssh.data.trusted[row.id]);
  const remove = useMutation({
    mutationFn: async (row: RouteRow) => {
      if (removesKeys(row) && !keyUnlocked) await api.post("/api/ssh/unlock", { password: deletePassword });
      return api.del<{ warning: string | null }>(`/api/instances/${row.id}`);
    },
    onSuccess: (data) => {
      setConfirmDelete(null);
      setDeletePassword("");
      setDeleteWarning(data.warning);
      invalidate();
      qc.invalidateQueries({ queryKey: ["ssh"] });
    },
    onError: (err) => {
      setDeleteError(err instanceof ApiError ? err.message : "Delete failed");
      // The key may have locked meanwhile: ask again, with the password field.
      qc.invalidateQueries({ queryKey: ["ssh"] });
    },
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
            setNaming({});
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500"
        >
          <HardDrive className="h-4 w-4" /> Name a machine
        </button>
      </header>

      {/* AdGuard's status is Routing's to show, beside Caddy's; each machine's own DNS
          state is in its row. */}
      {result && <SaveBanner result={result} />}
      {deleteWarning && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          {deleteWarning}
        </p>
      )}

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
          tools={tools.data}
          onTool={(machine, toolId) => setToolFor({ machine, toolId })}
          onTerminal={(machine) => setTerminalFor({ machine })}
          onUpdate={
            tools.data?.some((t) => t.id === "system" && t.actions.some((a) => a.id === "update"))
              ? (machine) => setTerminalFor({ machine, run: { tool: "system", action: "update", title: "Update" } })
              : undefined
          }
          onName={(m) => {
            setError(null);
            setNaming({ address: m.upstream ?? "" });
          }}
          onDelete={(m) => {
            setDeleteError(null);
            setDeletePassword("");
            setConfirmDelete(m);
          }}
          // Routes are the Routing tab's, even on a machine's row.
          onAddRoute={
            may("routing")
              ? (m) => {
                  setError(null);
                  setRouteOn(m);
                }
              : undefined
          }
          busyId={remove.isPending ? remove.variables?.id : null}
        />
      )}

      <AddMachineModal
        key={naming ? `naming-${naming.address ?? ""}` : "closed"}
        open={naming !== null}
        baseDomain={baseDomain}
        address={naming?.address}
        pending={save.isPending}
        error={error}
        onSubmit={(m) => save.mutate(m)}
        onClose={() => setNaming(null)}
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

      {toolFor && (
        <ToolDialog
          machine={{ id: toolFor.machine.id, name: toolFor.machine.name }}
          toolId={toolFor.toolId}
          onClose={() => setToolFor(null)}
        />
      )}
      {terminalFor && (
        <MachineTerminal
          key={terminalFor.machine.id}
          machine={{ id: terminalFor.machine.id, name: terminalFor.machine.name }}
          sshKey={ssh.data?.key ?? null}
          run={terminalFor.run}
          onClose={() => {
            setTerminalFor(null);
            // An update changes what the overview counts as waiting.
            if (terminalFor.run) qc.invalidateQueries({ queryKey: ["ssh-facts"] });
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete machine"
        destructive
        confirmLabel="Delete"
        onCancel={() => {
          setConfirmDelete(null);
          setDeleteError(null);
        }}
        onConfirm={() => {
          setDeleteError(null);
          if (confirmDelete) remove.mutate(confirmDelete);
        }}
      >
        This deletes <span className="font-medium text-slate-200">{confirmDelete?.name}</span>{" "}
        and its DNS rewrite{confirmDelete?.subdomain && sshHosts[confirmDelete.subdomain] ? " and SSH entry" : ""}.
        {removesKeys(confirmDelete)
          ? " Loskai's key is taken off the machine first; nothing else on it changes."
          : " The machine itself isn't affected."}
        {removesKeys(confirmDelete) && !keyUnlocked && (
          <input
            type="password"
            autoComplete="current-password"
            aria-label="Your password"
            placeholder="Your password — unlocks Loskai's key"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            className="mt-3 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
          />
        )}
        {deleteError && <span className="mt-2 block text-rose-400">{deleteError}</span>}
        {/* Deleting a machine doesn't break what runs on it: nothing links those routes,
            so they keep the address they already have. */}
        {deleting.length > 0 && (
          <span className="mt-2 block text-amber-300">
            {deleting.length === 1 ? "1 route is" : `${deleting.length} routes are`} on its
            address ({deleting.map((r) => r.name).join(", ")}). They keep it and go on working.
          </span>
        )}
      </ConfirmDialog>

      {openId && <MachineDialog key={openId} id={openId} section={section} />}
    </div>
  );
}
