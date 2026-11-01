import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { api } from "../lib/api";
import { useFacts, useSsh } from "../lib/ssh";
import { toolSummary, type ToolContext } from "../lib/toolRows";
import { addable, applies, missing, useTools } from "../lib/tools";
import { isMachine } from "../components/routing/machine";
import { ToolCard } from "../components/routing/MachineTools";
import type { RouteRow } from "../components/routing/ServiceTable";
import { useToolRunner } from "../components/routing/useToolRunner";

// One added tool on one machine — opened from the Tools button on its row in the Machines
// tab, or its card on the machine's page: its lists (sessions, projects) with their
// buttons, and its actions.
export function MachineTool() {
  const { id = "", tool: toolId = "" } = useParams();
  const routes = useQuery({
    queryKey: ["caddy-routes"],
    queryFn: () => api.get<RouteRow[]>("/api/caddy/routes"),
  });
  const ssh = useSsh();
  const trusted = Boolean(ssh.data?.trusted[id]);
  const facts = useFacts(id, trusted);
  const tools = useTools();
  const machine = routes.data?.find((r) => r.id === id && isMachine(r));
  const runner = useToolRunner(machine && { id: machine.id, name: machine.name }, ssh.data?.key ?? null);
  const tool = tools.data?.find((t) => t.id === toolId);

  const back = (
    <Link
      to={`/machines/${id}`}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
    >
      <ArrowLeft className="h-4 w-4" /> {machine?.name ?? "Machine"}
    </Link>
  );
  if (!machine || !tool || !facts.data || !ssh.data) {
    const loading = routes.isLoading || tools.isLoading || (trusted && facts.isLoading) || ssh.isLoading;
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        {back}
        {loading ? (
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-500" />
        ) : (
          <p className="text-sm text-slate-500">{!machine ? "No such machine." : !tool ? "No such tool." : "Set up SSH to use its tools."}</p>
        )}
      </div>
    );
  }

  const ctx: ToolContext = {
    machineId: id,
    tools: tools.data ?? [],
    facts: facts.data,
    folder: ssh.data.projects[id],
    onRun: runner.start,
  };
  const programs = facts.data.programs ?? [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {back}
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">{tool.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {tool.description}
          {facts.data.ok && applies(tool, programs) && toolSummary(tool, ctx) && <> · {toolSummary(tool, ctx)}</>}
        </p>
      </header>
      <div className="max-w-3xl">
        {!facts.data.ok ? (
          <p className="text-xs text-amber-300">{facts.data.error}</p>
        ) : applies(tool, programs) ? (
          <ToolCard tool={tool} ctx={ctx} titled={false} />
        ) : (
          <div className="flex items-center gap-3 text-sm text-slate-400">
            Needs {missing(tool, programs).join(", ")}.
            {addable(tool, programs) && (
              <button
                onClick={() => runner.start({ tool: tool.id, install: true, title: `Add ${tool.name}` })}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" /> Add {tool.name}
              </button>
            )}
          </div>
        )}
      </div>
      {runner.ui}
    </div>
  );
}
