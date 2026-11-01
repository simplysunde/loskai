import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Play } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { commandFor, type Plugin, type PluginAction, type PluginRun } from "../../lib/plugins";

const BUTTON =
  "flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent";

// A machine's plugins: every one in the image, each enabled or not on this machine. An
// enabled plugin shows its machine actions; one missing a tool offers to install it. The
// actions on a row of the Running list are there, not here.
export function MachinePlugins({
  machineId,
  plugins,
  enabled,
  tools,
  manager,
  onRun,
}: {
  machineId: string;
  plugins: Plugin[];
  enabled: string[];
  // From the overview: what the machine has, and its package manager.
  tools: string[];
  manager: string | null;
  onRun: (run: PluginRun, action?: PluginAction) => void;
}) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (next: string[]) => api.put(`/api/ssh/machines/${machineId}/plugins`, { plugins: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ssh"] }),
  });

  return (
    <div className="space-y-2">
      {plugins.map((p) => {
        const on = enabled.includes(p.id);
        const missing = p.requires.filter((t) => !tools.includes(t));
        const machineActions = p.actions.filter((a) => a.target === null);
        return (
          <div key={p.id} className="rounded-lg border border-slate-800 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className={`text-sm ${on ? "text-slate-100" : "text-slate-400"}`}>{p.name}</span>
                <span className="ml-2 text-xs text-slate-500">{p.description}</span>
              </div>
              <button
                onClick={() => save.mutate(on ? enabled.filter((id) => id !== p.id) : [...enabled, p.id])}
                disabled={save.isPending}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs ${
                  on ? "border border-slate-700 text-slate-300 hover:bg-slate-800" : "bg-teal-600 text-white hover:bg-teal-500"
                }`}
              >
                {on ? "Disable" : "Enable"}
              </button>
            </div>

            {on && missing.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-300">
                Needs {missing.join(", ")}
                {missing.map((tool) =>
                  p.install[tool] ? (
                    <button
                      key={tool}
                      title={installHint(p, tool, manager)}
                      onClick={() => onRun({ plugin: p.id, install: tool, title: `Install ${tool}` })}
                      className={BUTTON}
                    >
                      <Download className="h-3.5 w-3.5" /> Install {tool}
                    </button>
                  ) : (
                    <span key={tool} className="text-slate-500">— {tool} can't be installed from here</span>
                  ),
                )}
              </div>
            )}

            {on && missing.length === 0 && machineActions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {machineActions.map((a) => {
                  const command = commandFor(a, manager);
                  return (
                    <button
                      key={a.id}
                      disabled={!command}
                      title={command ? `${a.description}\n$ ${command}` : `No command for ${manager ?? "this machine"}'s package manager`}
                      onClick={() => onRun({ plugin: p.id, action: a.id, title: a.label }, a)}
                      className={BUTTON}
                    >
                      <Play className="h-3.5 w-3.5" /> {a.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {save.isPending && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
      {save.isError && (
        <p className="text-xs text-rose-400">
          {save.error instanceof ApiError ? save.error.message : "Couldn't save the plugins"}
        </p>
      )}
    </div>
  );
}

function installHint(p: Plugin, tool: string, manager: string | null): string {
  const how = p.install[tool];
  if (how.script) return `$ ${how.script}`;
  const pkg = manager ? how.packages?.[manager] : undefined;
  return pkg ? `Installs the ${pkg} package with ${manager}` : `No ${tool} package for ${manager ?? "this machine"}'s package manager`;
}
