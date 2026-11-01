import { Play, Plus } from "lucide-react";

import { commandFor, missing, type Tool, type ToolAction, type ToolRun } from "../../lib/tools";

const BUTTON =
  "flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent";

// A machine's tools: each that applies here — it has every program the tool requires —
// with its machine actions; then the ones Loskai can add, by installing what they lack.
// Nothing is enabled or stored. The actions on a row of the Running list are there, not here.
export function MachineTools({
  tools,
  programs,
  manager,
  onRun,
}: {
  tools: Tool[];
  // From the overview: what the machine has, and its package manager.
  programs: string[];
  manager: string | null;
  onRun: (run: ToolRun, action?: ToolAction) => void;
}) {
  const here = tools.filter((t) => missing(t, programs).length === 0);
  const addable = tools.filter((t) => {
    const lacking = missing(t, programs);
    return lacking.length > 0 && lacking.every((p) => t.installable.includes(p));
  });

  return (
    <div className="space-y-2">
      {here.map((t) => {
        const machineActions = t.actions.filter((a) => a.target === null);
        if (machineActions.length === 0) return null;
        return (
          <div key={t.id} className="rounded-lg border border-slate-800 px-3 py-2">
            <div title={t.description} className="text-sm text-slate-100">
              {t.name}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {machineActions.map((a) => {
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
            </div>
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
