import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { HardDrive, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

import { factsQuery, tailscaleStatus, useFacts, useSsh, type Facts, type SshKey } from "../../lib/ssh";
import { isLive, listsOf, toolContext, type ToolContext } from "../../lib/toolRows";
import { applies, useTools, type Tool, type ToolAction } from "../../lib/tools";
import { SectionPane } from "../shared/SectionPane";
import { Shell } from "./MachineDialog";
import { Ask, RowButtons } from "./MachineTools";
import { useToolRunner } from "./useToolRunner";

type Machine = { id: string; name: string; upstream?: string | null };

// What an action asks for when it makes a project: a name (Claude Code's New project) or a
// repository (Git's Clone).
const MAKES = ["project", "repo"];

// A machine's projects as its cards list them — the rows are the same on every tool that
// lists them, so one is read — with the tools that apply there.
function projectsOf(ctx: ToolContext) {
  const here = ctx.tools.filter((t) => applies(t, ctx.facts.programs ?? []));
  const lister = here.find((t) => t.actions.some((a) => a.target === "project"));
  const rows = (lister && listsOf(lister, ctx).find((l) => l.kind === "project")?.rows) ?? [];
  const makers = here.flatMap((t) => t.actions.filter((a) => a.ask && MAKES.includes(a.ask)).map((a) => ({ tool: t, action: a })));
  return { here, rows, makers };
}

// Every machine's projects in one place, from the Machines tab: a side menu of the machines
// that have any, and each project once — its git and its Claude session together, with the
// buttons its cards have (Git's, Claude Code's), run in that machine's terminal. A machine
// with none isn't listed; New project, above, makes one on any machine that can. A
// project's own settings stay on its machine's page.
export function ProjectsOverview({ machines, onClose }: { machines: Machine[]; onClose: () => void }) {
  const ssh = useSsh();
  const tools = useTools();
  const set = machines.filter((m) => ssh.data?.trusted[m.id]);
  const reads = useQueries({ queries: set.map((m) => factsQuery(m.id)) });

  const read = set.map((m, i) => {
    const q = reads[i];
    const ctx = toolContext(m.id, tools.data, q.data, ssh.data);
    return { machine: m, facts: q.data, error: q.isError, ctx, ...(ctx ? projectsOf(ctx) : { here: [], rows: [], makers: [] }) };
  });
  const reading = read.filter((r) => !r.facts && !r.error).length;
  const failed = read.filter((r) => r.error || (r.facts && !r.facts.ok));
  const listed = read.filter((r) => r.rows.length > 0);
  const makers = read.filter((r) => r.makers.length > 0);

  return (
    <Shell
      label="Projects"
      title={
        <span className="flex items-center gap-2">
          Projects
          {reading > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
        </span>
      }
      onClose={onClose}
    >
      {set.length === 0 ? (
        <p className="p-5 text-sm text-slate-500">No machine has SSH set up yet.</p>
      ) : (
        <SectionPane
          ready
          top={
            <div className="space-y-2 pt-4">
              {makers.length > 0 && <NewProject on={makers} ssh={ssh.data?.key ?? null} />}
              {failed.map((r) => (
                <p key={r.machine.id} className="text-xs text-amber-300">
                  {r.machine.name}: {r.facts && !r.facts.ok ? r.facts.error : "couldn't read it"}
                </p>
              ))}
              {listed.length === 0 && reading === 0 && (
                <p className="text-sm text-slate-500">No projects on any machine yet.</p>
              )}
            </div>
          }
          sections={listed.map((r) => ({
            id: r.machine.id,
            label: r.machine.name,
            icon: HardDrive,
            group: 0,
            // The search finds a machine by its projects too.
            words: r.rows.map((p) => p.name).join(" "),
            action: <MachineLine machine={r.machine} facts={r.facts!} onClose={onClose} />,
            content: <MachineProjects machine={r.machine} />,
          }))}
        />
      )}
    </Shell>
  );
}

// Beside a machine's name: what it is in a line, and the way to its dialog.
function MachineLine({ machine, facts, onClose }: { machine: Machine; facts: Facts; onClose: () => void }) {
  const sessions = (facts.tmux ?? []).filter((s) => !s.tool).length;
  const line = [
    machine.upstream,
    facts.programs?.includes("tailscale") ? `Tailscale ${tailscaleStatus(facts)}` : null,
    facts.programs?.includes("tmux") ? `${sessions} tmux ${sessions === 1 ? "session" : "sessions"}` : null,
  ].filter(Boolean);
  return (
    <span className="flex min-w-0 items-baseline gap-3">
      <span className="hidden truncate font-mono text-xs text-slate-500 sm:inline">{line.join(" · ")}</span>
      <Link
        to={`/machines/${machine.id}/tools`}
        onClick={onClose}
        title="Its dialog — its tools, and each project's settings"
        className="shrink-0 text-xs text-teal-400 hover:underline"
      >
        Machine
      </Link>
    </span>
  );
}

// Make a project on a machine picked from those that can: Claude Code's New project, Git's
// Clone — in that machine's terminal. It is listed here once its overview is read again.
function NewProject({
  on,
  ssh,
}: {
  on: { machine: Machine; makers: { tool: Tool; action: ToolAction }[] }[];
  ssh: SshKey | null;
}) {
  const [picked, setPicked] = useState(on[0].machine.id);
  const at = on.find((r) => r.machine.id === picked) ?? on[0];
  const runner = useToolRunner(at.machine, ssh);
  return (
    <div role="group" aria-label="New project" className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 px-3 py-2">
      <select
        aria-label="On machine"
        value={at.machine.id}
        onChange={(e) => setPicked(e.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
      >
        {on.map((r) => (
          <option key={r.machine.id} value={r.machine.id}>
            {r.machine.name}
          </option>
        ))}
      </select>
      {at.makers.map(({ tool, action }) => (
        <Ask key={`${tool.id}.${action.id}`} tool={tool} action={action} onRun={runner.start} />
      ))}
      {runner.ui}
    </div>
  );
}

// One machine's projects, each with its buttons. Its overview is the one the list read.
function MachineProjects({ machine }: { machine: Machine }) {
  const ssh = useSsh();
  const tools = useTools();
  const facts = useFacts(machine.id, true);
  const runner = useToolRunner(machine, ssh.data?.key ?? null);
  const ctx = toolContext(machine.id, tools.data, facts.data, ssh.data, runner.start);
  if (!ctx) return null;
  const { here, rows } = projectsOf(ctx);
  const claude = here.find((t) => t.id === "claude");
  return (
    <>
      {/* As on a card: on a wider screen every row's buttons start in one column; on a
          phone they go under its name. */}
      <ul className="space-y-1.5 text-xs text-slate-300 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-2 sm:gap-y-1.5 sm:space-y-0">
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
      {runner.ui}
    </>
  );
}
