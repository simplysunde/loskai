import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { HardDrive, Loader2, Plus } from "lucide-react";
import { Link } from "react-router-dom";

import { factsQuery, tailscaleStatus, useFacts, useSsh, type Facts, type SshKey } from "../../lib/ssh";
import { COLUMNS, isLive, listsOf, toolContext, type ToolContext } from "../../lib/toolRows";
import { CARD_TABLE } from "../../lib/ui";
import { applies, useTools, type Tool, type ToolAction, type ToolTarget } from "../../lib/tools";
import { SectionPane } from "../shared/SectionPane";
import { Shell } from "./MachineDialog";
import { RowButtons } from "./MachineTools";
import { Overlay } from "../shared/Modal";
import { useToolRunner } from "./useToolRunner";

type Machine = { id: string; name: string; upstream?: string | null };

// On a phone a table's headings are hidden, so a cell that is only a time or a number
// says which it is.
const PHONE: Record<string, string> = { "Last commit": "committed", Claude: "Claude" };

// Each table's column widths, the name's first — the same on every machine, so they line
// up under the one heading. The buttons' column fits the most a row has (a project's five,
// about 300px, with its padding), and they never wrap there: a wrapped one made rows of two
// lines.
const WIDTHS: Partial<Record<ToolTarget, string[]>> = {
  project: ["w-[22%]", "w-[15%]", "w-[17%]", "w-[11%]", "w-[10%]"],
  session: ["w-[37%]", "w-[17%]", "w-[21%]"],
};
const ACTIONS_WIDTH = "w-[21.5rem]";

// A table's column widths (a wider screen's: a phone's rows are cards).
function Columns({ kind }: { kind: ToolTarget }) {
  const widths = WIDTHS[kind] ?? [];
  return (
    <colgroup className="max-sm:hidden">
      {widths.map((w, i) => (
        <col key={i} className={w} />
      ))}
      <col className={ACTIONS_WIDTH} />
    </colgroup>
  );
}

// The projects' column headings: once, pinned above every machine — and, for a screen
// reader, in each table.
function Head({ kind, className = "" }: { kind: ToolTarget; className?: string }) {
  return (
    <thead className={`text-[11px] uppercase text-slate-500 ${className}`}>
      <tr>
        <th className="px-2.5 py-1.5 font-medium">Project</th>
        {(COLUMNS[kind] ?? []).map((c) => (
          <th key={c} className="px-2.5 py-1.5 font-medium">
            {c}
          </th>
        ))}
        <th className="px-2.5 py-1.5 font-medium">
          <span className="sr-only">Actions</span>
        </th>
      </tr>
    </thead>
  );
}

// What an action asks for when it makes a project, in the order they are offered: a name
// (Claude Code's New project), then a repository (Git's Clone).
const MAKES = ["project", "repo"];

// A machine's rows of a kind as its cards list them — the same on every tool that lists
// them, so one is read.
function rowsHere(here: Tool[], kind: ToolTarget, ctx: ToolContext) {
  const lister = here.find((t) => t.actions.some((a) => a.target === kind));
  return (lister && listsOf(lister, ctx).find((l) => l.kind === kind)?.rows) ?? [];
}

// A machine's projects, and its tmux sessions of your own (Claude's are on their
// projects), with the tools that apply there.
function projectsOf(ctx: ToolContext) {
  const here = ctx.tools.filter((t) => applies(t, ctx.facts.programs ?? []));
  const rows = rowsHere(here, "project", ctx);
  const sessions = rowsHere(here, "session", ctx);
  const makers = here
    .flatMap((t) => t.actions.filter((a) => a.ask && MAKES.includes(a.ask)).map((a) => ({ tool: t, action: a })))
    .sort((a, b) => MAKES.indexOf(a.action.ask!) - MAKES.indexOf(b.action.ask!));
  return { here, rows, sessions, makers };
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
    return { machine: m, facts: q.data, error: q.isError, ctx, ...(ctx ? projectsOf(ctx) : { here: [], rows: [], sessions: [], makers: [] }) };
  });
  const reading = read.filter((r) => !r.facts && !r.error).length;
  const failed = read.filter((r) => r.error || (r.facts && !r.facts.ok));
  const listed = read.filter((r) => r.rows.length > 0);
  const makers = read.filter((r) => r.makers.length > 0);

  return (
    <Shell
      label="Projects"
      wide
      title={
        <span className="flex items-center gap-2">
          Projects
          {reading > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
        </span>
      }
      action={makers.length > 0 && <NewProject on={makers} ssh={ssh.data?.key ?? null} />}
      onClose={onClose}
    >
      {set.length === 0 ? (
        <p className="p-5 text-sm text-slate-500">No machine has SSH set up yet.</p>
      ) : (
        <SectionPane
          across
          ready
          top={
            (failed.length > 0 || (listed.length === 0 && reading === 0)) && (
              <div className="space-y-2 pt-3">
                {failed.map((r) => (
                  <p key={r.machine.id} className="text-xs text-amber-300">
                    {r.machine.name}: {r.facts && !r.facts.ok ? r.facts.error : "couldn't read it"}
                  </p>
                ))}
                {listed.length === 0 && reading === 0 && (
                  <p className="text-sm text-slate-500">
                    No projects on any machine yet{makers.length > 0 ? " — New project, above, makes one." : "."}
                  </p>
                )}
              </div>
            )
          }
          pinned={
            listed.length > 0 && (
              // Bordered like the tables under it, so its columns sit over theirs.
              <table aria-hidden className="mb-1 w-full table-fixed border border-slate-800 bg-slate-900/60 text-left max-sm:hidden">
                <Columns kind="project" />
                <Head kind="project" />
              </table>
            )
          }
          sections={listed.map((r) => ({
            id: r.machine.id,
            label: r.machine.name,
            icon: HardDrive,
            group: 0,
            // The search finds a machine by its projects and sessions too.
            words: [...r.rows, ...r.sessions].map((p) => p.name).join(" "),
            action: <MachineLine machine={r.machine} facts={r.facts!} />,
            content: <MachineProjects machine={r.machine} />,
          }))}
        />
      )}
    </Shell>
  );
}

// Beside a machine's name: what it is in a line, and the way to its dialog. Its tmux
// sessions are listed under its projects.
function MachineLine({ machine, facts }: { machine: Machine; facts: Facts }) {
  const line = [
    machine.upstream,
    facts.programs?.includes("tailscale") ? `Tailscale ${tailscaleStatus(facts)}` : null,
  ].filter(Boolean);
  return (
    <span className="flex min-w-0 items-baseline gap-3">
      <span className="hidden truncate font-mono text-xs text-slate-500 sm:inline">{line.join(" · ")}</span>
      {/* Over this dialog, which stays: closing the machine's comes back here. */}
      <Link
        to={`/machines/${machine.id}/tools`}
        title="Its dialog, over this one — its tools, and each project's settings"
        className="shrink-0 text-xs text-teal-400 hover:underline"
      >
        Machine
      </Link>
    </span>
  );
}

// How a project is made, by what its action asks for.
const WAYS: Record<string, { label: string; field: string; placeholder: string }> = {
  project: { label: "New folder", field: "Name", placeholder: "my-project" },
  repo: { label: "Clone a repository", field: "Repository", placeholder: "https://… or git@host:path" },
};

const FIELD =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-teal-500";

// New project, in the dialog's header: a dialog to make one on a machine picked from those
// that can — a new folder (Claude Code's New project) or a clone (Git's) — then its run in
// that machine's terminal. It is listed once its overview is read again.
function NewProject({
  on,
  ssh,
}: {
  on: { machine: Machine; makers: { tool: Tool; action: ToolAction }[] }[];
  ssh: SshKey | null;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(on[0].machine.id);
  const [way, setWay] = useState(0);
  const [value, setValue] = useState("");
  const at = on.find((r) => r.machine.id === picked) ?? on[0];
  const maker = at.makers[way] ?? at.makers[0];
  const shown = WAYS[maker.action.ask!] ?? { label: maker.action.label, field: "Name", placeholder: "" };
  const runner = useToolRunner(at.machine, ssh);
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title="Make a project on one of your machines — a new folder, or a clone"
        className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
      >
        <Plus className="h-3.5 w-3.5" /> New project
      </button>
      {open && (
        <Overlay onClose={close} label="New project">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const target = value.trim();
              if (!target) return;
              close();
              setValue("");
              runner.start({ tool: maker.tool.id, action: maker.action.id, target, title: `${maker.action.label}: ${target}` }, maker.action);
            }}
          >
            <h2 className="text-base font-semibold text-slate-100">New project</h2>
            <p className="mt-1 text-sm text-slate-400">Made in the machine's projects folder, in its terminal.</p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-sm text-slate-200">Machine</span>
                <select
                  aria-label="Machine"
                  value={at.machine.id}
                  onChange={(e) => {
                    setPicked(e.target.value);
                    setWay(0);
                  }}
                  className={FIELD}
                >
                  {on.map((r) => (
                    <option key={r.machine.id} value={r.machine.id}>
                      {r.machine.name}
                    </option>
                  ))}
                </select>
              </label>
              {at.makers.length > 1 && (
                <fieldset>
                  <legend className="mb-1.5 text-sm text-slate-200">How</legend>
                  <div className="space-y-1.5">
                    {at.makers.map((m, i) => (
                      <label key={`${m.tool.id}.${m.action.id}`} className="flex items-start gap-2 text-sm text-slate-300">
                        <input type="radio" name="way" checked={m === maker} onChange={() => setWay(i)} className="mt-1 accent-teal-500" />
                        <span>
                          {WAYS[m.action.ask!]?.label ?? m.action.label}
                          <span className="block text-xs text-slate-500">{m.action.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <label className="block">
                <span className="mb-1.5 block text-sm text-slate-200">{shown.field}</span>
                <input
                  aria-label={shown.field}
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={shown.placeholder}
                  className={`${FIELD} font-mono`}
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!value.trim()}
                title={`${maker.action.description}\n$ ${typeof maker.action.run === "string" ? maker.action.run : ""}`}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
              >
                {maker.action.label}
              </button>
            </div>
          </form>
        </Overlay>
      )}
      {runner.ui}
    </>
  );
}

// One machine's projects, then its tmux sessions, each with its buttons. Its overview is
// the one the list read.
function MachineProjects({ machine }: { machine: Machine }) {
  const ssh = useSsh();
  const tools = useTools();
  const facts = useFacts(machine.id, true);
  const runner = useToolRunner(machine, ssh.data?.key ?? null);
  const ctx = toolContext(machine.id, tools.data, facts.data, ssh.data, runner.start);
  if (!ctx) return null;
  const { here, rows, sessions } = projectsOf(ctx);
  const claude = here.find((t) => t.id === "claude");
  // A table of a kind of row: its name, its COLUMNS, its buttons. On a phone each row is a
  // card (CARD_TABLE): the name on a line of its own, the cells that say something, then
  // the buttons.
  const table = (kind: ToolTarget, items: typeof rows, label: string) => (
    <div className="overflow-hidden rounded-lg border border-slate-800 max-sm:border-0">
      <table aria-label={label} className={`w-full text-left text-xs sm:table-fixed ${CARD_TABLE}`}>
        <Columns kind={kind} />
        {/* The headings are the one pinned above every machine; here only for a screen reader. */}
        {kind === "project" && <Head kind={kind} className="sr-only" />}
        <tbody className="divide-y divide-slate-800/70">
          {items.map((r) => (
            <tr key={r.name} className="text-slate-400 hover:bg-slate-800/30 max-sm:py-2">
              <td className="truncate px-2.5 py-1 max-sm:basis-full max-sm:whitespace-normal">
                <span title={r.title ?? r.name} className="font-mono text-slate-200">
                  {r.name}
                </span>
                {kind === "project" && claude && isLive(claude, "project", r.name, ctx.facts) && (
                  <span className="ml-2 text-emerald-300">running</span>
                )}
                {r.tag && <span className="ml-2 text-slate-500">{r.tag}</span>}
              </td>
              {r.cells.map((c, i) => {
                const column = COLUMNS[kind]?.[i];
                return (
                  <td
                    key={column ?? i}
                    title={column === "Last commit" ? r.title : c || undefined}
                    className={`truncate px-2.5 py-1 ${c ? "" : "max-sm:hidden"}`}
                  >
                    {/* On a phone, with no headings: what a bare time is. */}
                    {c && column && PHONE[column] && <span className="sm:hidden">{PHONE[column]} </span>}
                    {c || <span className="text-slate-600">—</span>}
                  </td>
                );
              })}
              <td className="px-2.5 py-1 max-sm:ml-auto">
                <span className="flex flex-wrap items-center justify-end gap-1 sm:flex-nowrap">
                  <RowButtons here={here} kind={kind} name={r.name} onRun={runner.start} facts={ctx.facts} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      {table("project", rows, "Projects")}
      {sessions.length > 0 && (
        <>
          <h3 className="mb-1 mt-3 text-xs text-slate-500">
            {sessions.length} tmux {sessions.length === 1 ? "session" : "sessions"}
          </h3>
          {table("session", sessions, "tmux sessions")}
        </>
      )}
      {runner.ui}
    </>
  );
}
