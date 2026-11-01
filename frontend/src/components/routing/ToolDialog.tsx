import { Check, Loader2, Plus, X } from "lucide-react";

import { useFacts, useSsh } from "../../lib/ssh";
import { toolSummary, type ToolContext } from "../../lib/toolRows";
import { addable, applies, missing, useTools } from "../../lib/tools";
import { Modal } from "../shared/Modal";
import { ToolCard } from "./MachineTools";
import { useToolRunner } from "./useToolRunner";

// One tool on one machine, from the Tools menu on its row: what it needs and whether the
// machine has it, then the tool itself — its lists and actions — or Add, where something is
// missing that Loskai can install.
export function ToolDialog({
  machine,
  toolId,
  onClose,
}: {
  machine: { id: string; name: string };
  toolId: string;
  onClose: () => void;
}) {
  const ssh = useSsh();
  const facts = useFacts(machine.id, true);
  const tools = useTools();
  const runner = useToolRunner(machine, ssh.data?.key ?? null);
  const tool = tools.data?.find((t) => t.id === toolId);

  let body: React.ReactNode = <Loader2 className="h-4 w-4 animate-spin text-slate-500" />;
  if (tool && facts.data && !facts.data.ok) {
    body = <p className="text-xs text-amber-300">{facts.data.error}</p>;
  } else if (tool && facts.data && tools.data && ssh.data) {
    const programs = facts.data.programs ?? [];
    const ctx: ToolContext = {
      machineId: machine.id,
      tools: tools.data,
      facts: facts.data,
      folder: ssh.data.projects[machine.id],
      onRun: runner.start,
    };
    const summary = applies(tool, programs) ? toolSummary(tool, ctx) : "";
    body = (
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          {tool.description}
          {summary && <span className="text-slate-500"> · {summary}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          Needs
          {tool.requires.map((p) =>
            programs.includes(p) ? (
              <span key={p} className="flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-300">
                <Check className="h-3 w-3" /> {p}
              </span>
            ) : (
              <span key={p} className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-amber-300">
                <X className="h-3 w-3" /> {p}
              </span>
            ),
          )}
        </div>
        {applies(tool, programs) ? (
          <ToolCard tool={tool} ctx={ctx} titled={false} />
        ) : addable(tool, programs) ? (
          <button
            onClick={() => runner.start({ tool: tool.id, install: true, title: `Add ${tool.name}` })}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs text-white hover:bg-teal-500"
          >
            <Plus className="h-3.5 w-3.5" /> Add {tool.name} — installs {missing(tool, programs).join(", ")}
          </button>
        ) : (
          <p className="text-xs text-slate-500">{missing(tool, programs).join(", ")} can't be installed from Loskai.</p>
        )}
      </div>
    );
  }

  return (
    <>
      <Modal title={`${tool?.name ?? "Tool"} — ${machine.name}`} onClose={onClose}>
        {body}
      </Modal>
      {runner.ui}
    </>
  );
}
