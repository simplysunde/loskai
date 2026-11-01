import { useState } from "react";
import { Play, Plus } from "lucide-react";

import type { Facts } from "../../lib/ssh";
import { commandFor, missing, type Tool, type ToolAction, type ToolRun, type ToolTarget } from "../../lib/tools";

const BUTTON =
  "flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent";

type Start = (run: ToolRun, action?: ToolAction) => void;

// A row a tool's card lists, for its actions on that kind of target.
interface Row {
  name: string;
  detail: string;
}

// The rows of each kind a card lists, from the overview. The Running list's kinds (service,
// container, lxc, vm) are on its own rows instead.
function rowsOf(kind: ToolTarget, facts: Facts): Row[] | null {
  if (kind === "session") {
    return (facts.tmux ?? []).map((s) => ({
      name: s.name,
      detail: `${s.windows} ${s.windows === 1 ? "window" : "windows"}${s.attached ? " · attached" : ""} · since ${new Date(s.created * 1000).toLocaleString()}`,
    }));
  }
  return null;
}

// The buttons the tools that apply put on a row of `kind` — a card's, or the Running list's.
export function rowButtons(here: Tool[], kind: ToolTarget, name: string, onRun: Start) {
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

// A machine's tools: each that applies here — it has every program the tool requires —
// with its actions; then the ones Loskai can add, by installing what they lack. Nothing is
// enabled or stored.
export function MachineTools({
  tools,
  facts,
  onRun,
}: {
  tools: Tool[];
  // The overview: what the machine has, its package manager, its sessions and projects.
  facts: Facts;
  onRun: Start;
}) {
  const programs = facts.programs ?? [];
  const manager = facts.updates?.manager ?? null;
  const here = tools.filter((t) => missing(t, programs).length === 0);
  const addable = tools.filter((t) => {
    const lacking = missing(t, programs);
    return lacking.length > 0 && lacking.every((p) => t.installable.includes(p));
  });

  return (
    <div className="space-y-2">
      {here.map((t) => {
        const own = t.actions.filter((a) => !a.target && !a.ask);
        const asks = t.actions.filter((a) => a.ask);
        const kinds = [...new Set(t.actions.map((a) => a.target).filter((k) => k !== null))];
        const lists = kinds.flatMap((k) => {
          const rows = rowsOf(k, facts);
          return rows ? [{ kind: k, rows }] : [];
        });
        if (own.length + asks.length + lists.length === 0) return null;
        return (
          <div key={t.id} className="rounded-lg border border-slate-800 px-3 py-2">
            <div title={t.description} className="text-sm text-slate-100">
              {t.name}
            </div>
            {lists.map(({ kind, rows }) => (
              <ul key={kind} className="mt-2 space-y-0.5 text-xs text-slate-300">
                {rows.length === 0 && <li className="text-slate-500">None yet.</li>}
                {rows.map((r) => (
                  <li key={r.name} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono">{r.name}</span>
                    <span className="flex shrink-0 items-center gap-2 text-slate-500">
                      {r.detail}
                      {rowButtons([t], kind, r.name, onRun)}
                    </span>
                  </li>
                ))}
              </ul>
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
                      onClick={() => onRun({ tool: t.id, action: a.id, title: a.label }, a)}
                      className={BUTTON}
                    >
                      <Play className="h-3.5 w-3.5" /> {a.label}
                    </button>
                  );
                })}
                {asks.map((a) => (
                  <Ask key={a.id} tool={t} action={a} onRun={onRun} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {addable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-500">
          Add
          {addable.map((t) => (
            <button
              key={t.id}
              title={`${t.description}\nInstalls ${missing(t, programs).join(", ")}`}
              onClick={() => onRun({ tool: t.id, install: true, title: `Add ${t.name}` })}
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

// An action that runs on a name typed for it — a new session, a new project. The server
// checks the name; it reaches the command as `$1`.
function Ask({ tool, action, onRun }: { tool: Tool; action: ToolAction; onRun: Start }) {
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
