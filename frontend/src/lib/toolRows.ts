import { formatAgo } from "./format";
import type { Facts } from "./ssh";
import { sessionName, type Tool, type ToolAction, type ToolRun, type ToolTarget } from "./tools";

// What a tool's card and page list, from a machine's overview — the rows of each kind of
// target, and a tool in a few words.

export type ToolStart = (run: ToolRun, action?: ToolAction) => void;

// A row a tool's card lists, for its actions on that kind of target.
interface Row {
  name: string;
  detail: string;
  title?: string;
}

// The rows of each kind a card lists, from the overview: the sessions no tool claims — a
// session `claude-site` is the Claude Code tool's, on its project — and the projects in the
// machine's projects folder (`~/projects`, `~`). The Running list's kinds (service,
// container, lxc, vm) are on its own rows instead.
function rowsOf(kind: ToolTarget, facts: Facts, folder: string, tools: Tool[]): Row[] | null {
  if (kind === "session") {
    const claimed = tools.flatMap((t) =>
      t.actions.flatMap((a) => (typeof a.session === "string" ? [`${a.session}-`] : [])),
    );
    return (facts.tmux ?? [])
      .filter((s) => !claimed.some((prefix) => s.name.startsWith(prefix)))
      .map((s) => ({
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
          p.ahead ? `${p.ahead} to push` : null,
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

// Where a tool's card shows, and what goes in it, from the overview and the machine's
// projects folder.
export interface ToolContext {
  machineId: string;
  tools: Tool[]; // every tool in the image — which sessions another one claims
  facts: Facts;
  folder: string;
  onRun: ToolStart;
}

export function listsOf(t: Tool, { facts, folder, tools }: ToolContext) {
  const kinds = [...new Set(t.actions.map((a) => a.target).filter((k) => k !== null))];
  return kinds.flatMap((k) => {
    const rows = rowsOf(k, facts, folder, tools);
    return rows ? [{ kind: k, rows }] : [];
  });
}

// A tool in a few words, for its card and its page: what its lists hold, how many of
// them run — or, for Tailscale, the machine's address.
export function toolSummary(t: Tool, ctx: ToolContext): string {
  if (t.requires.includes("tailscale")) {
    const tailnet = ctx.facts.tailnet ?? [];
    if (!ctx.facts.tailscale) return "not connected";
    const online = tailnet.filter((d) => d.online).length;
    return tailnet.length ? `${ctx.facts.tailscale} · ${online} of ${tailnet.length} online` : ctx.facts.tailscale;
  }
  const sessions = new Set((ctx.facts.tmux ?? []).map((s) => s.name));
  return listsOf(t, ctx)
    .map(({ kind, rows }) => {
      const live = rows.filter((r) => isLive(t, kind, r.name, sessions)).length;
      const noun = kind === "project" ? "project" : "session";
      return `${rows.length} ${noun}${rows.length === 1 ? "" : "s"}${live ? `, ${live} running` : ""}`;
    })
    .join(" · ");
}

// A row whose shared session is running: opening it attaches.
export function isLive(t: Tool, kind: ToolTarget, name: string, sessions: Set<string>): boolean {
  return t.actions.some(
    (a) => a.target === kind && typeof a.session === "string" && sessions.has(sessionName(a.session, name)),
  );
}

