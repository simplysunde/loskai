import { useState } from "react";
import { Play, Plus, Wrench } from "lucide-react";

import { useFacts, useSsh } from "../../lib/ssh";
import { isLive, listsOf, toolSummary, type ToolContext, type ToolStart } from "../../lib/toolRows";
import {
  addable,
  applies,
  commandFor,
  isStandard,
  missing,
  type Tool,
  type ToolAction,
  type ToolTarget,
} from "../../lib/tools";
import { RowMenu } from "../shared/RowMenu";

const BUTTON =
  "flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent";

// The buttons the tools that apply put on a row of `kind` — a card's, or the Running list's.
export function RowButtons({
  here,
  kind,
  name,
  onRun,
}: {
  here: Tool[];
  kind: ToolTarget;
  name: string;
  onRun: ToolStart;
}) {
  return here.flatMap((t) =>
    t.actions
      .filter((a) => a.target === kind)
      .map((a) => (
        <button
          key={`${t.id}-${a.id}`}
          title={`${a.description}\n$ ${typeof a.run === "string" ? a.run : ""}`.trim()}
          onClick={() => onRun({ tool: t.id, action: a.id, target: name, title: `${a.label} ${name}` }, a)}
          className="text-[11px] text-teal-400 hover:underline"
        >
          {a.label}
        </button>
      )),
  );
}

// One tool, as a card: its lists with their row buttons, its machine actions, and the
// actions that ask for a name. Null when it has nothing to show here — Services' buttons
// are all on the Running list's rows.
export function ToolCard({ tool: t, ctx, titled = true }: { tool: Tool; ctx: ToolContext; titled?: boolean }) {
  const manager = ctx.facts.updates?.manager ?? null;
  const own = t.actions.filter((a) => !a.target && !a.ask);
  const asks = t.actions.filter((a) => a.ask);
  const lists = listsOf(t, ctx);
  const sessions = new Set((ctx.facts.tmux ?? []).map((s) => s.name));
  if (own.length + asks.length + lists.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-800 px-3 py-2">
      {titled && (
        <div title={t.description} className="flex items-baseline gap-2 text-sm text-slate-100">
          {t.name}
          {!isStandard(t) && <span className="text-xs text-slate-500">{toolSummary(t, ctx)}</span>}
        </div>
      )}
      {lists.map(({ kind, rows }) => (
        <div key={kind} className="mt-2">
          <ul className="space-y-1 text-xs text-slate-300">
            {rows.length === 0 && <li className="text-slate-500">None yet.</li>}
            {rows.map((r) => (
              <li key={r.name} title={r.title} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-mono">{r.name}</span>
                  {isLive(t, kind, r.name, sessions) && <span className="ml-2 text-emerald-300">running</span>}
                  <span className="block truncate text-slate-500">{r.detail}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2"><RowButtons here={[t]} kind={kind} name={r.name} onRun={ctx.onRun} /></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {(own.length > 0 || asks.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {own.map((a) => {
            const command = commandFor(a, manager);
            return (
              <button
                key={a.id}
                disabled={!command}
                title={command ? `${a.description}\n$ ${command}` : `No command for ${manager ?? "this machine"}'s package manager`}
                onClick={() => ctx.onRun({ tool: t.id, action: a.id, title: a.label }, a)}
                className={BUTTON}
              >
                <Play className="h-3.5 w-3.5" /> {a.label}
              </button>
            );
          })}
          {asks.map((a) => (
            <Ask key={a.id} tool={t} action={a} onRun={ctx.onRun} />
          ))}
        </div>
      )}
    </div>
  );
}

// A machine's tools on its page: a card for each that applies here — an added one's name
// opens its own page — then the ones Loskai can add, by installing what they lack.
export function MachineTools({ ctx }: { ctx: ToolContext }) {
  const programs = ctx.facts.programs ?? [];
  const more = ctx.tools.filter((t) => addable(t, programs));
  return (
    <div className="space-y-2">
      {ctx.tools
        .filter((t) => applies(t, programs))
        .map((t) => (
          <ToolCard key={t.id} tool={t} ctx={ctx} />
        ))}
      {more.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-500">
          Add
          {more.map((t) => (
            <button
              key={t.id}
              title={`${t.description}\nInstalls ${missing(t, programs).join(", ")}`}
              onClick={() => ctx.onRun({ tool: t.id, install: true, title: `Add ${t.name}` })}
              className={BUTTON}
            >
              <Plus className="h-3.5 w-3.5" /> {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The Tools button on a machine's row in the Machines tab: each added tool with how it
// stands there, opening it in a dialog. The machine's overview is read only while the menu
// is open — the Machines tab doesn't otherwise ask for it.
export function ToolsMenu({
  machineId,
  tools,
  className,
  onPick,
}: {
  machineId: string;
  tools: Tool[];
  className: string;
  onPick: (toolId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const facts = useFacts(machineId, open);
  const ssh = useSsh();
  const added = tools.filter((t) => !isStandard(t));
  if (added.length === 0) return null;

  const status = (t: Tool): string => {
    if (!facts.data) return "…";
    if (!facts.data.ok) return "";
    const programs = facts.data.programs ?? [];
    if (!applies(t, programs)) return addable(t, programs) ? "not added" : `needs ${missing(t, programs).join(", ")}`;
    const ctx: ToolContext = {
      machineId,
      tools,
      facts: facts.data,
      folder: ssh.data?.projects[machineId] ?? "",
      onRun: () => {},
    };
    return toolSummary(t, ctx) || "added";
  };

  return (
    <RowMenu
      label="Tools"
      trigger={<Wrench className="h-3.5 w-3.5" />}
      triggerClass={className}
      onOpenChange={setOpen}
      items={added.map((t) => ({
        label: t.name,
        hint: status(t),
        icon: <Wrench className="h-3.5 w-3.5" />,
        onClick: () => onPick(t.id),
      }))}
    />
  );
}

// An action that runs on a name typed for it — a new session, a new project. The server
// checks the name; it reaches the command as `$1`.
function Ask({ tool, action, onRun }: { tool: Tool; action: ToolAction; onRun: ToolStart }) {
  const [name, setName] = useState("");
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onRun({ tool: tool.id, action: action.id, target: name.trim(), title: `${action.label}: ${name.trim()}` }, action);
        setName("");
      }}
    >
      <input
        aria-label={`${action.label} — name`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="name"
        className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200"
      />
      <button type="submit" disabled={!name.trim()} title={`${action.description}\n$ ${typeof action.run === "string" ? action.run : ""}`} className={BUTTON}>
        <Plus className="h-3.5 w-3.5" /> {action.label}
      </button>
    </form>
  );
}
