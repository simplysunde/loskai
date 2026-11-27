import { FolderGit2, HardDrive, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

import { overviewError, useFacts, useSsh } from "../../lib/ssh";
import { projectsOf, toolContext } from "../../lib/toolRows";
import { applies, isOnCard, isProjectTool, useTools } from "../../lib/tools";
import { Modal } from "../shared/Modal";
import { OwnButtons } from "./MachineTools";
import { ProjectTables } from "./ProjectsOverview";
import { CardKeys } from "./SshKeys";
import { ToolAsk } from "./ToolAsk";
import { OverviewProblem } from "./ToolDialog";
import { CardSettings, GitIdentity } from "./ToolSettings";
import { useToolRunner } from "./useToolRunner";

// One machine's Projects, from the Projects button on its row: the tools of its projects and
// tmux sessions together (`isProjectTool` — Git, Claude Code, tmux), as far as it has them.
// Each project once, with every such tool's buttons and its own settings; then its tmux
// sessions; at the foot, the tools' own actions (Pull all) and what asks for a name (Clone,
// New project, New session). Git's Keys and Settings are in the header, as on its card.
export function ProjectsDialog({ machine, onClose }: { machine: { id: string; name: string }; onClose: () => void }) {
  const ssh = useSsh();
  const facts = useFacts(machine.id, true);
  const tools = useTools();
  const runner = useToolRunner(machine, ssh.data?.key ?? null);
  const ctx = toolContext(machine.id, tools.data, facts.data, ssh.data, runner.start);
  const error = overviewError(facts, tools, ssh);

  let body: React.ReactNode = <Loader2 className="h-4 w-4 animate-spin text-slate-500" />;
  if (error) {
    body = <OverviewProblem machineId={machine.id} error={error} old={facts.data?.old} onClose={onClose} />;
  } else if (ctx) {
    const programs = ctx.facts.programs ?? [];
    const here = ctx.tools.filter((t) => isProjectTool(t) && applies(t, programs));
    const { rows } = projectsOf(ctx);
    const lists = here.some((t) => t.actions.some((a) => a.target === "project"));
    const asks = here.flatMap((t) => t.actions.filter((a) => a.ask && isOnCard(a)).map((a) => ({ tool: t, action: a })));
    body = (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            Projects are located:
            <span className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-slate-300">
              {ctx.folder.endsWith("/") ? ctx.folder : `${ctx.folder}/`}
            </span>
            {here.map((t) => (
              <GitIdentity key={t.id} tool={t} ctx={ctx} />
            ))}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {here.map((t) => (
              <CardKeys key={t.id} tool={t} ctx={ctx} />
            ))}
            {here.map((t) => (
              <CardSettings key={t.id} tool={t} ctx={ctx} />
            ))}
            <Link
              to={`/machines/${machine.id}/tools`}
              onClick={onClose}
              title="This machine's dialog — its name, SSH and every tool"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
            >
              <HardDrive className="h-3.5 w-3.5" /> Machine
            </Link>
          </div>
        </div>
        {lists && rows.length === 0 && <p className="text-xs text-slate-500">No projects there yet.</p>}
        <ProjectTables ctx={ctx} settings />
        <div className="flex flex-wrap items-center gap-1">
          {here.map((t) => (
            <OwnButtons key={t.id} tool={t} ctx={ctx} small />
          ))}
        </div>
        {asks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {asks.map(({ tool, action }) => (
              <ToolAsk key={`${tool.id}.${action.id}`} tool={tool} action={action} onRun={ctx.onRun} />
            ))}
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
            <FolderGit2 className="h-4 w-4 text-slate-400" />
            {`Projects — ${machine.name}`}
          </span>
        }
        label={`Projects — ${machine.name}`}
        wide
        onClose={onClose}
      >
        {body}
      </Modal>
      {runner.ui}
    </>
  );
}
