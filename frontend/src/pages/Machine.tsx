import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, HardDrive, Loader2, Pencil, Settings, Terminal } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";

import { api } from "../lib/api";
import { missing, useTools, type ToolAction, type ToolRun, type ToolTarget } from "../lib/tools";
import type { SettingsView } from "../lib/settings";
import { useFacts, useRunning, useSsh } from "../lib/ssh";
import { AddMachineModal } from "../components/routing/AddMachineModal";
import { isMachine } from "../components/routing/machine";
import { MachineOverview } from "../components/routing/MachineOverview";
import { MachineTerminal } from "../components/routing/MachineTerminal";
import { MachineTools, rowButtons } from "../components/routing/MachineTools";
import { RunningList } from "../components/routing/RunningPill";
import type { RouteRow } from "../components/routing/ServiceTable";
import { SshSetupModal } from "../components/routing/SshSetupModal";
import { useSaveMachine, type SaveResult } from "../components/routing/useSaveMachine";
import { SshLog } from "../components/settings/SshLog";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { SaveBanner } from "../components/routing/SaveBanner";

// What the Machines tab hands over after naming a machine: what the save said, and whether
// to start its SSH setup.
export interface MachineState {
  result?: SaveResult;
  setup?: boolean;
}

const BUTTON =
  "flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800";

// One machine — the cog on its row. What belongs to this machine alone lives here: its
// name, address and SSH login, its SSH setup, its overview, its tools, what runs on it,
// and its log. What is the same for every machine is in Settings › SSH.
export function Machine() {
  const { id = "" } = useParams();
  const handed = (useLocation().state ?? {}) as MachineState;
  const [result, setResult] = useState<SaveResult | null>(handed.result ?? null);
  const [setup, setSetup] = useState(Boolean(handed.setup));
  const [editing, setEditing] = useState(false);
  const [terminal, setTerminal] = useState(false);
  // A tool's action in the terminal, and one waiting for its confirmation.
  const [run, setRun] = useState<ToolRun | null>(null);
  const [confirming, setConfirming] = useState<{ run: ToolRun; action: ToolAction } | null>(null);
  const qc = useQueryClient();
  const tools = useTools();
  const [error, setError] = useState<string | null>(null);

  const routes = useQuery({
    queryKey: ["caddy-routes"],
    queryFn: () => api.get<RouteRow[]>("/api/caddy/routes"),
    refetchInterval: 15_000,
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsView>("/api/settings"),
  });
  const ssh = useSsh();
  const trusted = Boolean(ssh.data?.trusted[id]);
  const running = useRunning(trusted);
  const facts = useFacts(id, trusted);

  const save = useSaveMachine({
    onSaved: (data, m) => {
      setEditing(false);
      setResult(data);
      // A login just given starts its setup, as naming a machine does.
      if (m.ssh && !trusted) setSetup(true);
    },
    onError: setError,
  });

  const machine = routes.data?.find((r) => r.id === id && isMachine(r));
  const programs = facts.data?.programs ?? [];
  const here = (tools.data ?? []).filter((t) => missing(t, programs).length === 0);

  const start = (r: ToolRun, action?: ToolAction) => {
    if (action?.confirm) setConfirming({ run: r, action });
    else setRun(r);
  };
  // The buttons a tool that applies here puts on a row of the Running list.
  const rowActions = (target: ToolTarget, name: string) => rowButtons(here, target, name, start);
  const host = machine?.subdomain ? ssh.data?.hosts[machine.subdomain] : undefined;

  if (!machine) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <BackLink />
        {routes.isLoading ? (
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-500" />
        ) : (
          <p className="text-sm text-slate-500">No such machine.</p>
        )}
      </div>
    );
  }

  const runningHere = running.data?.[id];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <BackLink />
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-100">
            <HardDrive className="h-5 w-5 text-teal-300/70" />
            {machine.name}
          </h1>
          <p className="mt-1 font-mono text-sm text-slate-500">
            {machine.fqdn ?? "—"} · {machine.upstream ?? "—"}
          </p>
        </div>
        {trusted && host && (
          <button onClick={() => setTerminal(true)} className={BUTTON}>
            <Terminal className="h-4 w-4" /> Terminal
          </button>
        )}
      </header>

      {result && <SaveBanner result={result} />}

      <div className="max-w-2xl space-y-6">
        <section>
          <h2 className="text-sm font-medium text-slate-200">Connection</h2>
          <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
            <dt className="text-slate-500">Address</dt>
            <dd className="font-mono text-slate-300">{machine.upstream ?? "—"}</dd>
            <dt className="text-slate-500">SSH</dt>
            <dd className="text-slate-300">
              {host?.user ? (
                <>
                  <span className="font-mono">
                    {host.user}@{host.hostname ?? machine.upstream}:{host.port}
                  </span>{" "}
                  {trusted ? (
                    <span className="text-xs text-emerald-300">set up</span>
                  ) : (
                    <span className="text-xs text-amber-300">not set up</span>
                  )}
                </>
              ) : (
                <span className="text-slate-500">No SSH user — give it one to manage it.</span>
              )}
            </dd>
          </dl>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                setError(null);
                setEditing(true);
              }}
              className={BUTTON}
            >
              <Pencil className="h-4 w-4" /> Edit
            </button>
            {host?.user && (
              <button
                title="Its host key, Loskai's key on it, and a test"
                onClick={() => setSetup(true)}
                className={BUTTON}
              >
                <Settings className="h-4 w-4" /> {trusted ? "SSH setup" : "Set up SSH"}
              </button>
            )}
          </div>
        </section>

        {host?.user && trusted && (
          <section className="border-t border-slate-800 pt-6">
            <h2 className="mb-3 text-sm font-medium text-slate-200">Overview</h2>
            <MachineOverview facts={facts.data} onReinstall={() => setSetup(true)} />
          </section>
        )}

        {host?.user && trusted && facts.data?.ok && tools.data && (
          <section className="border-t border-slate-800 pt-6">
            <h2 className="mb-3 text-sm font-medium text-slate-200">Tools</h2>
            <MachineTools tools={tools.data} facts={facts.data} onRun={start} />
          </section>
        )}

        {host?.user && (
          <section className="border-t border-slate-800 pt-6">
            <h2 className="text-sm font-medium text-slate-200">Running</h2>
            <div className="mt-3 rounded-lg border border-slate-800 p-3 text-xs text-slate-300">
              {!trusted ? (
                <p className="text-slate-500">Set up SSH to see what runs here.</p>
              ) : !runningHere ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
              ) : runningHere.ok ? (
                <RunningList running={runningHere} user={host.user} actions={rowActions} />
              ) : (
                <p className="text-amber-300">Unreachable: {runningHere.error}</p>
              )}
            </div>
          </section>
        )}

        {host?.user && (
          <section className="border-t border-slate-800 pt-6">
            <h2 className="mb-3 text-sm font-medium text-slate-200">Log</h2>
            <SshLog machine={id} />
          </section>
        )}
      </div>

      <AddMachineModal
        key={String(editing)}
        open={editing}
        baseDomain={settings.data?.base_domain?.value ?? null}
        editing={{
          id: machine.id,
          hostname: machine.subdomain ?? machine.id,
          address: machine.upstream ?? "",
          name: machine.name,
        }}
        ssh={host ?? null}
        pending={save.isPending}
        error={error}
        onSubmit={(m) => save.mutate(m)}
        onClose={() => setEditing(false)}
      />

      {/* Shown once the SSH config has the login: just after a save, on its refetch. */}
      {setup && host?.user && (
        <SshSetupModal
          machine={{ id: machine.id, name: machine.name }}
          host={host}
          sshKey={ssh.data?.key ?? null}
          onClose={() => setSetup(false)}
        />
      )}

      {(terminal || run) && (
        <MachineTerminal
          machine={{ id: machine.id, name: machine.name }}
          sshKey={ssh.data?.key ?? null}
          run={run ?? undefined}
          onClose={() => {
            setTerminal(false);
            setRun(null);
            // What it ran may have changed what runs there, and what the machine has.
            qc.invalidateQueries({ queryKey: ["ssh-facts"] });
            qc.invalidateQueries({ queryKey: ["ssh-running"] });
          }}
        />
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={`${confirming?.run.title ?? ""} — ${machine.name}`}
        destructive
        confirmLabel={confirming?.action.label}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) setRun(confirming.run);
          setConfirming(null);
        }}
      >
        {confirming?.action.confirm}
      </ConfirmDialog>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/machines"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
    >
      <ArrowLeft className="h-4 w-4" /> Machines
    </Link>
  );
}
