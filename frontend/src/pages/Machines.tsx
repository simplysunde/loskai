import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { FolderGit2, HardDrive, Loader2 } from "lucide-react";

import { api, apiMessage } from "../lib/api";
import { refreshRecords, saveNew, useRouteRows } from "../lib/routes";
import { useSettings } from "../lib/settings";
import { takesKeysOff, useRunning, useSsh } from "../lib/ssh";
import { MACHINE_TOOL, useTools, type ToolRun } from "../lib/tools";
import { useHealth } from "../lib/useHealth";
import { AddMachineModal } from "../components/routing/AddMachineModal";
import { AddRouteModal, type NewLink, type NewRoute } from "../components/routing/AddRouteModal";
import type { MachineService } from "../components/routing/machineServices";
import { isMachine, routesOn, unnamedDockerHost } from "../components/routing/machine";
import { MachineTable } from "../components/routing/MachineTable";
import { MachineTerminal } from "../components/routing/MachineTerminal";
import { SaveBanner } from "../components/routing/SaveBanner";
import { ProjectsOverview } from "../components/routing/ProjectsOverview";
import { ToolDialog } from "../components/routing/ToolDialog";
import type { RouteRow } from "../components/routing/ServiceTable";
import { useSaveMachine, type SaveResult } from "../components/routing/useSaveMachine";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { MachineDialog, type MachineState } from "../components/routing/MachineDialog";

// Named LAN machines: a name that resolves to an address, and nothing more — no route, no
// certificate. Every route on a machine's address is on it, so moving it here re-points them all.
// The records are the same instances Routing reads (`kind: "machine"`), from the same
// endpoint; this tab is a reading of that one store, not a second one.
export function Machines() {
  const qc = useQueryClient();
  const health = useHealth();
  const navigate = useNavigate();
  // The machine open in its dialog, from the cog on its row.
  const { id: openId, section } = useParams();
  // Naming a machine — the Docker host's address when named from its row, a Proxmox guest's
  // name and address from a running list; editing one is in its dialog.
  const [naming, setNaming] = useState<{ address?: string; name?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RouteRow | null>(null);
  // Deleting a set-up machine takes Loskai's key off it first, which needs the key unlocked:
  // your password, typed in the dialog when it is locked. What went wrong shows there;
  // a machine deleted with its key still on it says so after.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null);
  // The machine a new route is being added on, from its row — with a port of its running
  // list already picked, from there.
  const [routeOn, setRouteOn] = useState<{ machine: RouteRow; service?: MachineService } | null>(null);
  // The machine with a terminal open, and what it runs there — its shell, or System's Update.
  const [terminalFor, setTerminalFor] = useState<{ machine: RouteRow; run?: ToolRun } | null>(null);
  // A tool on a machine, from the Tools menu on its row.
  const [toolFor, setToolFor] = useState<{ machine: RouteRow; toolId: string } | null>(null);
  // Every machine's projects, from the header.
  const [projects, setProjects] = useState(false);

  const { routes, rows } = useRouteRows();
  const settings = useSettings();
  const baseDomain = settings.data?.base_domain?.value ?? null;
  const ssh = useSsh();
  const tools = useTools();
  const sshHosts = ssh.data?.hosts ?? {};
  const trusted = ssh.data?.trusted ?? {};
  const running = useRunning(Object.keys(trusted).length > 0);

  const named = rows.filter(isMachine);
  const dockerHost = unnamedDockerHost(settings.data?.host_ip?.value, named);
  const machines = dockerHost ? [...named, dockerHost] : named;

  const invalidate = () => {
    refreshRecords(qc);
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
    mutationFn: (r: NewRoute | NewLink) => saveNew(r),
    onSuccess: (data) => {
      setRouteOn(null);
      setResult(data);
      invalidate();
    },
    onError: (err) => setError(apiMessage(err, "Add route failed")),
  });

  const remove = useMutation({
    // With Loskai's key on it and the key locked, the delete asks for your password (api.ts).
    mutationFn: (row: RouteRow) => api.del<{ warning: string | null }>(`/api/instances/${row.id}`),
    onSuccess: (data) => {
      setConfirmDelete(null);
      setDeleteWarning(data.warning);
      invalidate();
      qc.invalidateQueries({ queryKey: ["ssh"] });
    },
    onError: (err) => setDeleteError(apiMessage(err, "Delete failed")),
  });

  const deleting = confirmDelete ? routesOn(confirmDelete, rows) : [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Machines</h1>
          <p className="mt-1 text-sm text-slate-500">
            Machines on your network, each with its DNS name and the routes it hosts.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start">
          {/* Once a machine can be read over SSH: what its projects are doing, all in one place. */}
          {Object.values(trusted).some(Boolean) && (
            <button
              onClick={() => setProjects(true)}
              title="Every machine's projects — their git, their Claude session — in one place"
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            >
              <FolderGit2 className="h-4 w-4" /> Projects
            </button>
          )}
          <button
            onClick={() => {
              setError(null);
              setNaming({});
            }}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500"
          >
            <HardDrive className="h-4 w-4" /> Name a machine
          </button>
        </div>
      </header>

      {/* AdGuard's status is Routing's to show, beside Caddy's; each machine's own DNS
          state is in its row. */}
      {result && <div className="mb-4"><SaveBanner result={result} /></div>}
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
          targets={ssh.data?.targets}
          trusted={trusted}
          running={running.data ?? {}}
          onOpen={(m) => navigate(`/machines/${m.id}`)}
          tools={tools.data}
          onTool={(machine, toolId) => setToolFor({ machine, toolId })}
          onTerminal={(machine) => setTerminalFor({ machine })}
          onUpdate={
            tools.data?.some((t) => t.id === MACHINE_TOOL && t.actions.some((a) => a.id === "update"))
              ? (machine) => setTerminalFor({ machine, run: { tool: MACHINE_TOOL, action: "update", title: "Update" } })
              : undefined
          }
          onName={(m) => {
            setError(null);
            setNaming({ address: m.upstream ?? "" });
          }}
          onNameGuest={(guest) => {
            setError(null);
            setNaming(guest);
          }}
          dockerHost={settings.data?.host_ip?.value}
          onDelete={(m) => {
            setDeleteError(null);
            setConfirmDelete(m);
          }}
          onAddRoute={(machine) => {
            setError(null);
            setRouteOn({ machine });
          }}
          onRouteService={(machine, service) => {
            setError(null);
            setRouteOn({ machine, service });
          }}
          busyId={remove.isPending ? remove.variables?.id : null}
        />
      )}

      <AddMachineModal
        key={naming ? `naming-${naming.name ?? ""}-${naming.address ?? ""}` : "closed"}
        open={naming !== null}
        baseDomain={baseDomain}
        address={naming?.address}
        name={naming?.name}
        pending={save.isPending}
        error={error}
        onSubmit={(m) => save.mutate(m)}
        onClose={() => setNaming(null)}
      />

      <AddRouteModal
        key={routeOn ? `${routeOn.machine.id}-${routeOn.service?.key ?? ""}` : "route-closed"}
        open={routeOn !== null}
        baseDomain={baseDomain}
        mode={health.data?.caddy?.mode ?? null}
        initialMachine={routeOn ? { id: routeOn.machine.id, address: routeOn.machine.upstream ?? "" } : undefined}
        initialService={routeOn?.service}
        pending={addRoute.isPending}
        error={error}
        onSubmit={(r) => addRoute.mutate(r)}
        onClose={() => setRouteOn(null)}
      />

      {projects && <ProjectsOverview machines={machines} onClose={() => setProjects(false)} />}
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
          // The row's only run is System's Update, which is automatic.
          quick={Boolean(terminalFor.run)}
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
        pending={remove.isPending}
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
        {confirmDelete && takesKeysOff(ssh.data, confirmDelete.id)
          ? " Loskai's key is taken off the machine first; nothing else on it changes."
          : " The machine itself isn't affected."}
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
