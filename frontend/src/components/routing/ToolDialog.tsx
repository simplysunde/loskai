import { Check, Loader2, Plus, Settings, X } from "lucide-react";
import { Link } from "react-router-dom";

import { ApiError } from "../../lib/api";
import { useFacts, useSsh } from "../../lib/ssh";
import { toolSummary, type ToolContext } from "../../lib/toolRows";
import { addable, applies, missing, useTools } from "../../lib/tools";
import { Modal } from "../shared/Modal";
import { ToolCard } from "./MachineTools";
import { ToolIcon } from "./ToolIcon";
import { useToolRunner } from "./useToolRunner";
import type { MachineState } from "./MachineDialog";

// One tool on one machine, from the Tools menu on its row: the tool itself — its lists and
// actions — or, where it isn't added yet, what it needs, which of that the machine has, and
// Add, when Loskai can install the rest.
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

  // The machine answered but couldn't be read, or a request failed outright (a 409 when its
  // SSH user or host key is gone) — either way, never a spinner that doesn't stop.
  const failed = [facts, tools, ssh].find((q) => q.isError && !q.data)?.error;
  const error =
    facts.data && !facts.data.ok
      ? facts.data.error
      : failed && (failed instanceof ApiError ? failed.message : "Couldn't reach Loskai");

  let body: React.ReactNode = <Loader2 className="h-4 w-4 animate-spin text-slate-500" />;
  if (error) {
    // A shortcut to where it is fixed: the machine's SSH setup reinstalls the status line.
    const old = facts.data?.old;
    const setup: MachineState = { setup: true };
    body = (
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-amber-300">{error}</p>
        <Link
          to={`/machines/${machine.id}/${old ? "ssh" : "general"}`}
          state={old ? setup : undefined}
          onClick={onClose}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
        >
          <Settings className="h-3.5 w-3.5" /> {old ? "Install again" : "Settings"}
        </Link>
      </div>
    );
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
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-slate-400">
            {tool.description}
            {summary && <span className="text-slate-500"> · {summary}</span>}
          </p>
          {/* The machine's own settings — its projects folder is on the Git tool's card. */}
          <Link
            to={`/machines/${machine.id}/tools`}
            onClick={onClose}
            title="The machine's settings — its projects folder is on the Git tool's card"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            <Settings className="h-3.5 w-3.5" /> Settings
          </Link>
        </div>
        {tool.actions.some((a) => a.target === "project" || a.ask === "project") && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            Projects are located:
            <span className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-slate-300">
              {ctx.folder.endsWith("/") ? ctx.folder : `${ctx.folder}/`}
            </span>
          </p>
        )}
        {applies(tool, programs) ? (
          <ToolCard tool={tool} ctx={ctx} titled={false} />
        ) : (
          <div className="space-y-3">
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
            {addable(tool, programs) ? (
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
        )}
      </div>
    );
  }

  return (
    <>
      <Modal
        title={
          <span className="flex items-center gap-2">
            <ToolIcon id={toolId} className="h-4 w-4 text-slate-400" />
            {`${tool?.name ?? "Tool"} — ${machine.name}`}
          </span>
        }
        onClose={onClose}
      >
        {body}
      </Modal>
      {runner.ui}
    </>
  );
}
