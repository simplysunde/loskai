import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

import { tailscaleStatus, useFacts, useSsh } from "../../lib/ssh";
import { isLive, listsOf, toolContext } from "../../lib/toolRows";
import { applies, useTools } from "../../lib/tools";
import { Modal } from "../shared/Modal";
import { RowButtons } from "./MachineTools";
import { useToolRunner } from "./useToolRunner";

type Machine = { id: string; name: string; upstream?: string | null };

// Every machine's projects in one place, from the Machines tab: a card for each machine with
// SSH set up, each project once — its git and its Claude session together, with the buttons
// its cards have (Git's, Claude Code's), run in that machine's terminal. To follow work
// across machines; a project's own settings stay on its machine's page.
export function ProjectsOverview({ machines, onClose }: { machines: Machine[]; onClose: () => void }) {
  const ssh = useSsh();
  const set = machines.filter((m) => ssh.data?.trusted[m.id]);
  return (
    <Modal title="Projects" onClose={onClose} wide>
      <div className="space-y-3 overflow-y-auto p-5">
        {!ssh.data ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
        ) : set.length === 0 ? (
          <p className="text-sm text-slate-500">No machine has SSH set up yet.</p>
        ) : (
          set.map((m) => <MachineProjects key={m.id} machine={m} onClose={onClose} />)
        )}
      </div>
    </Modal>
  );
}

// One machine's card: what it is in a line, then its projects — read from its overview while
// the dialog is open. One that can't be read says why, and holds up no other.
function MachineProjects({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const ssh = useSsh();
  const tools = useTools();
  const facts = useFacts(machine.id, true);
  const runner = useToolRunner(machine, ssh.data?.key ?? null);
  const ctx = toolContext(machine.id, tools.data, facts.data, ssh.data, runner.start);
  const here = (ctx?.tools ?? []).filter((t) => applies(t, ctx?.facts.programs ?? []));
  // The project rows are the same on every tool that lists them; Git's and Claude Code's
  // buttons go on each.
  const lister = here.find((t) => t.actions.some((a) => a.target === "project"));
  const rows = (ctx && lister && listsOf(lister, ctx).find((l) => l.kind === "project")?.rows) ?? null;
  const claude = here.find((t) => t.id === "claude");
  const sessions = (ctx?.facts.tmux ?? []).filter((s) => !s.tool).length;

  const line = [
    machine.upstream,
    ctx?.facts.programs?.includes("tailscale") ? `Tailscale ${tailscaleStatus(ctx.facts)}` : null,
    ctx && ctx.facts.programs?.includes("tmux") ? `${sessions} tmux ${sessions === 1 ? "session" : "sessions"}` : null,
  ].filter(Boolean);

  return (
    <section aria-label={machine.name} className="rounded-lg border border-slate-800 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <Link
          to={`/machines/${machine.id}/tools`}
          onClick={onClose}
          title="Its dialog — its tools, and each project's settings"
          className="text-sm font-medium text-slate-100 hover:text-teal-300 hover:underline"
        >
          {machine.name}
        </Link>
        <span className="font-mono text-xs text-slate-500">{line.join(" · ")}</span>
      </div>
      {facts.data && !facts.data.ok ? (
        <p className="mt-1.5 text-xs text-amber-300">{facts.data.error}</p>
      ) : facts.isError ? (
        <p className="mt-1.5 text-xs text-amber-300">Couldn't read it.</p>
      ) : !ctx ? (
        <Loader2 className="mt-2 h-4 w-4 animate-spin text-slate-500" />
      ) : !rows ? (
        <p className="mt-1.5 text-xs text-slate-500">No git here — no projects.</p>
      ) : rows.length === 0 ? (
        <p className="mt-1.5 text-xs text-slate-500">No projects in {ctx.folder || "~/projects"} yet.</p>
      ) : (
        // As on a card: on a wider screen every row's buttons start in one column; on a
        // phone they go under its name.
        <ul className="mt-2 space-y-1.5 text-xs text-slate-300 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-2 sm:gap-y-1.5 sm:space-y-0">
          {rows.map((r) => (
            <li key={r.name} className="flex flex-col gap-1 sm:contents">
              <span title={r.title} className="min-w-0">
                <span className="break-all font-mono">{r.name}</span>
                {claude && isLive(claude, "project", r.name, ctx.facts) && <span className="ml-2 text-emerald-300">running</span>}
                <span className="block truncate text-slate-500">{r.detail}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <RowButtons here={here} kind="project" name={r.name} onRun={runner.start} facts={ctx.facts} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {runner.ui}
    </section>
  );
}
