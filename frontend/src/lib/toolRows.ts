import { formatAgo } from "./format";
import { tailscaleStatus, type Facts, type SshStatus } from "./ssh";
import type { Tool, ToolAction, ToolRun, ToolTarget } from "./tools";

// What a tool's card and page list, from a machine's overview — the rows of each kind of
// target, and a tool in a few words.

export type ToolStart = (run: ToolRun, action?: ToolAction) => void;

// A row a tool's card lists, for its actions on that kind of target: `detail` on a card,
// under its name; `cells` in a table, under COLUMNS (an empty one says nothing); `tag`
// beside its name in either.
interface Row {
  name: string;
  detail: string;
  title?: string;
  cells: string[];
  tag?: string;
}

// A table's columns for each kind of row, after its name — Projects' tables. A kind with
// none here has cells that say what they are.
export const COLUMNS: Partial<Record<ToolTarget, string[]>> = {
  project: ["Branch", "Changes", "Last commit", "Claude"],
};

// The rows of each kind a card lists, from the overview: the sessions no tool claims — a
// session `claude-site` is the Claude Code tool's, on its project, as the server says — and
// the projects in the machine's projects folder (`~/projects`, `~`). The Running list's
// kinds (service, container, lxc, vm) are on its own rows instead.
function rowsOf(kind: ToolTarget, facts: Facts, folder: string): Row[] | null {
  if (kind === "session") {
    return (facts.tmux ?? [])
      .filter((s) => !s.tool)
      .map((s) => {
        const windows = `${s.windows} ${s.windows === 1 ? "window" : "windows"}`;
        const since = new Date(s.created * 1000).toLocaleString();
        return {
          name: s.name,
          detail: `${windows}${s.attached ? " · attached" : ""} · since ${since}`,
          title: `Since ${since}`,
          cells: [windows, `started ${formatAgo(s.created)}`],
          tag: s.attached ? "attached" : undefined,
        };
      });
  }
  if (kind === "project") {
    const relative = folder === "~" ? "" : folder.replace(/^~\//, "");
    return (facts.projects ?? [])
      .filter((p) => p.folder === relative)
      .map((p) => {
        const branch = p.branch ?? "no branch";
        const changes = [p.ahead ? `${p.ahead} to push` : null, p.dirty ? "uncommitted changes" : null].filter(Boolean);
        const committed = p.committed ? formatAgo(p.committed) : null;
        const claude = p.claude ? formatAgo(p.claude) : null;
        return {
          name: p.name,
          detail: [branch, ...changes, committed ? `committed ${committed}` : "no commits", claude && `Claude ${claude}`]
            .filter(Boolean)
            .join(" · "),
          title: p.subject ? `Last commit: ${p.subject}` : undefined,
          cells: [branch, changes.join(", "), committed ?? "no commits", claude ?? ""],
        };
      });
  }
  return null;
}

// Where a tool's card shows, and what goes in it, from the overview and the machine's
// projects folder.
export interface ToolContext {
  machineId: string;
  tools: Tool[]; // every tool in the image
  facts: Facts;
  folder: string;
  onRun: ToolStart;
}

// What a machine's tools are worked out from, once its overview has been read — null
// before then. `onRun` starts a run; a summary that starts nothing leaves it out.
export function toolContext(
  machineId: string,
  tools: Tool[] | undefined,
  facts: Facts | undefined,
  ssh: SshStatus | undefined,
  onRun: ToolStart = () => {},
): ToolContext | null {
  if (!facts?.ok || !tools || !ssh) return null;
  return { machineId, tools, facts, folder: ssh.projects[machineId] ?? "", onRun };
}

export function listsOf(t: Tool, { facts, folder }: ToolContext) {
  const kinds = [...new Set(t.actions.map((a) => a.target).filter((k) => k !== null))];
  return kinds.flatMap((k) => {
    const rows = rowsOf(k, facts, folder);
    return rows ? [{ kind: k, rows }] : [];
  });
}

// A tool in a few words, for its card and its page: what its lists hold, how many of
// them run — or, for Tailscale, the machine's address and what it shares.
export function toolSummary(t: Tool, ctx: ToolContext): string {
  if (t.requires.includes("tailscale")) {
    const status = tailscaleStatus(ctx.facts);
    if (status !== ctx.facts.tailscale) return status;
    const shared = ctx.facts.tailscale_self?.shared ?? [];
    return shared.length ? `${ctx.facts.tailscale} · sharing ${shared.join(", ")}` : ctx.facts.tailscale;
  }
  return listsOf(t, ctx)
    .map(({ kind, rows }) => {
      const live = rows.filter((r) => isLive(t, kind, r.name, ctx.facts)).length;
      const noun = kind === "project" ? "project" : "session";
      return `${rows.length} ${noun}${rows.length === 1 ? "" : "s"}${live ? `, ${live} running` : ""}`;
    })
    .join(" · ");
}

// A row whose shared session is running, as the server says: opening it attaches.
export function isLive(t: Tool, kind: ToolTarget, name: string, facts: Facts): boolean {
  return facts.live?.[t.id]?.[kind]?.includes(name) ?? false;
}

