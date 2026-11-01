import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Play, Plus } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { formatAgo } from "../../lib/format";
import type { Facts } from "../../lib/ssh";
import {
  commandFor,
  missing,
  sessionName,
  type Tool,
  type ToolAction,
  type ToolRun,
  type ToolTarget,
} from "../../lib/tools";

const BUTTON =
  "flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent";

type Start = (run: ToolRun, action?: ToolAction) => void;

// A row a tool's card lists, for its actions on that kind of target.
interface Row {
  name: string;
  detail: string;
  title?: string;
}

// The rows of each kind a card lists, from the overview — projects, those in the machine's
// projects folder (`~/projects`, `~`). The Running list's kinds (service, container, lxc,
// vm) are on its own rows instead.
function rowsOf(kind: ToolTarget, facts: Facts, folder: string): Row[] | null {
  if (kind === "session") {
    return (facts.tmux ?? []).map((s) => ({
      name: s.name,
      detail: `${s.windows} ${s.windows === 1 ? "window" : "windows"}${s.attached ? " · attached" : ""} · since ${new Date(s.created * 1000).toLocaleString()}`,
    }));
  }
  if (kind === "project") {
    const relative = folder === "~" ? "" : folder.replace(/^~\//, "");
    return (facts.projects ?? [])
      .filter((p) => p.folder === relative)
      .map((p) => ({
        name: p.name,
        detail: [
          p.branch ?? "no branch",
          p.dirty ? "uncommitted changes" : null,
          p.committed ? `committed ${formatAgo(p.committed)}` : "no commits",
          p.claude ? `Claude ${formatAgo(p.claude)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        title: p.subject ? `Last commit: ${p.subject}` : undefined,
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
  machineId,
  tools,
  facts,
  folder,
  onRun,
}: {
  machineId: string;
  tools: Tool[];
  // The overview: what the machine has, its package manager, its sessions and projects.
  facts: Facts;
  folder: string; // its projects folder
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
          const rows = rowsOf(k, facts, folder);
          return rows ? [{ kind: k, rows }] : [];
        });
        // A row whose shared session is running says so: opening it attaches.
        const sessions = new Set((facts.tmux ?? []).map((s) => s.name));
        const live = (kind: ToolTarget, name: string) =>
          t.actions.some(
            (a) => a.target === kind && typeof a.session === "string" && sessions.has(sessionName(a.session, name)),
          );
        if (own.length + asks.length + lists.length === 0) return null;
        return (
          <div key={t.id} className="rounded-lg border border-slate-800 px-3 py-2">
            <div title={t.description} className="text-sm text-slate-100">
              {t.name}
            </div>
            {lists.map(({ kind, rows }) => (
              <div key={kind} className="mt-2">
                {kind === "project" && <Folder machineId={machineId} folder={folder} />}
                <ul className="space-y-0.5 text-xs text-slate-300">
                  {rows.length === 0 && <li className="text-slate-500">None yet.</li>}
                  {rows.map((r) => (
                    <li key={r.name} title={r.title} className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono">
                        {r.name}
                        {live(kind, r.name) && <span className="ml-2 font-sans text-emerald-300">running</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-slate-500">
                        {r.detail}
                        {rowButtons([t], kind, r.name, onRun)}
                      </span>
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

// Where a machine's projects are — `~/projects` unless changed here: `~` or one folder in it.
function Folder({ machineId, folder }: { machineId: string; folder: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (next: string) => api.put(`/api/ssh/machines/${machineId}/projects`, { folder: next }),
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["ssh"] });
    },
  });
  if (editing === null) {
    return (
      <p className="mb-1 flex items-center gap-1.5 text-xs text-slate-500">
        Projects in <span className="font-mono text-slate-300">{folder}</span>
        <button title="Change the projects folder" onClick={() => setEditing(folder)} className="hover:text-slate-200">
          <Pencil className="h-3 w-3" />
        </button>
      </p>
    );
  }
  return (
    <form
      className="mb-1 flex flex-wrap items-center gap-1.5 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(editing);
      }}
    >
      <input
        aria-label="Projects folder"
        value={editing}
        onChange={(e) => setEditing(e.target.value)}
        className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-slate-200"
      />
      <button type="submit" disabled={save.isPending} className={BUTTON}>
        Save
      </button>
      <button type="button" onClick={() => setEditing(null)} className="text-slate-500 hover:text-slate-300">
        Cancel
      </button>
      {save.isError && (
        <span className="text-rose-400">{save.error instanceof ApiError ? save.error.message : "Couldn't save it"}</span>
      )}
    </form>
  );
}
