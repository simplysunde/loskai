import { useState } from "react";
import { Plus, Wrench } from "lucide-react";

import { useFacts, useSsh } from "../../lib/ssh";
import { ActionIcon, ToolIcon } from "./ToolIcon";
import { isLive, listsOf, toolContext, toolSummary, type ToolContext, type ToolStart } from "../../lib/toolRows";
import {
  addable,
  applies,
  commandFor,
  isStandard,
  missing,
  type Tool,
  type ToolAction,
  type ToolTarget,
} from "../../lib/tools";
import { RowMenu } from "../shared/RowMenu";
import { ToolSettings } from "./ToolSettings";

const BUTTON =
  "flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent";

// The buttons the tools that apply put on a row of `kind` — a card's, or the Running list's:
// small bordered ones, in rose for those that ask first (End, Stop).
export function RowButtons({
  here,
  kind,
  name,
  onRun,
}: {
  here: Tool[];
  kind: ToolTarget;
  name: string;
  onRun: ToolStart;
}) {
  return here.flatMap((t) =>
    t.actions
      .filter((a) => a.target === kind)
      .map((a) => (
        <button
          key={`${t.id}-${a.id}`}
          title={`${a.description}\n$ ${typeof a.run === "string" ? a.run : ""}`.trim()}
          onClick={() => onRun({ tool: t.id, action: a.id, target: name, title: `${a.label} ${name}` }, a)}
          className={`flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[11px] hover:bg-slate-800 ${
            a.confirm ? "text-rose-300" : "text-slate-200"
          }`}
        >
          <ActionIcon tool={t.id} action={a.id} />
          {a.label}
        </button>
      )),
  );
}

// One tool, as a card: its lists with their row buttons, its machine actions, and the
// actions that ask for a name. Null when it has nothing to show here — Services' buttons
// are all on the Running list's rows.
export function ToolCard({ tool: t, ctx, titled = true }: { tool: Tool; ctx: ToolContext; titled?: boolean }) {
  const manager = ctx.facts.updates?.manager ?? null;
  const own = t.actions.filter((a) => !a.target && !a.ask);
  const asks = t.actions.filter((a) => a.ask);
  const lists = listsOf(t, ctx);
  const sessions = new Set((ctx.facts.tmux ?? []).map((s) => s.name));
  // Git's card holds the projects folder even without settings of its own.
  const settings = (t.settings?.length ?? 0) > 0 || t.id === "git";
  if (own.length + asks.length + lists.length === 0 && !settings) return null;
  return (
    <div className="rounded-lg border border-slate-800 px-3 py-2">
      {titled && (
        <div title={t.description} className="flex items-center gap-2 text-sm text-slate-100">
          <ToolIcon id={t.id} className="h-3.5 w-3.5 text-slate-400" />
          {t.name}
          {!isStandard(t) && <span className="text-xs text-slate-500">{toolSummary(t, ctx)}</span>}
        </div>
      )}
      {settings && <ToolSettings tool={t} ctx={ctx} />}
      {/* Tailscale's card: the tailnet as this machine sees it — devices, not targets. */}
      {t.requires.includes("tailscale") && (ctx.facts.tailnet?.length ?? 0) > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-slate-300">
          {ctx.facts.tailnet!.map((d) => (
            <li key={d.ip} title={d.status} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${d.online ? "bg-emerald-400" : "bg-slate-600"}`} />
                <span className="truncate font-mono">{d.name}</span>
                {d.self && <span className="text-slate-500">this machine</span>}
              </span>
              <span className="shrink-0 text-slate-500">
                <span className="font-mono">{d.ip}</span> · {d.os}
              </span>
            </li>
          ))}
        </ul>
      )}
      {t.requires.includes("tailscale") && <SharedNetworks routes={ctx.facts.tailscale_routes} />}
      {lists.map(({ kind, rows }) => (
        <div key={kind} className="mt-2">
          <ul className="space-y-1.5 text-xs text-slate-300">
            {rows.length === 0 && <li className="text-slate-500">None yet.</li>}
            {rows.map((r) => (
              <li key={r.name} title={r.title} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                <span className="min-w-0">
                  <span className="break-all font-mono">{r.name}</span>
                  {isLive(t, kind, r.name, sessions) && <span className="ml-2 text-emerald-300">running</span>}
                  <span className="block truncate text-slate-500">{r.detail}</span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1"><RowButtons here={[t]} kind={kind} name={r.name} onRun={ctx.onRun} /></span>
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
                onClick={() => ctx.onRun({ tool: t.id, action: a.id, title: a.label }, a)}
                className={BUTTON}
              >
                <ActionIcon tool={t.id} action={a.id} className="h-3.5 w-3.5" /> {a.label}
              </button>
            );
          })}
          {asks.map((a) => (
            <Ask key={a.id} tool={t} action={a} onRun={ctx.onRun} />
          ))}
        </div>
      )}
    </div>
  );
}

const ADMIN = "https://login.tailscale.com/admin";
const OUT_LINK = "text-teal-400 hover:text-teal-300 hover:underline";

// What the machine shares with the tailnet (Share this network), and whether Tailscale has
// approved it — until it does, nothing goes through. Approving it, and split DNS, are in
// Tailscale's admin console: Loskai holds no Tailscale key to do either.
function SharedNetworks({ routes }: { routes?: { shared: string[]; approved: string[] } | null }) {
  if (!routes?.shared.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs text-slate-300">
      {routes.shared.map((net) =>
        routes.approved.includes(net) ? (
          <li key={net} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            Sharing <span className="font-mono">{net}</span>
            <a
              href={`${ADMIN}/dns`}
              target="_blank"
              rel="noreferrer"
              title="Your names away from home also need split DNS: a nameserver for your AdGuard, restricted to your base domain"
              className={OUT_LINK}
            >
              Split DNS
            </a>
          </li>
        ) : (
          <li key={net} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
            <span className="font-mono">{net}</span>
            <span className="text-amber-300">waiting for approval</span>
            <a
              href={`${ADMIN}/machines`}
              target="_blank"
              rel="noreferrer"
              title="Machines › this machine's ⋯ menu › Edit route settings — approve it. Disable key expiry there too."
              className={OUT_LINK}
            >
              Approve
            </a>
          </li>
        ),
      )}
    </ul>
  );
}

// A machine's tools, in its dialog: a card for each that applies here. The ones Loskai can
// add are behind Add tool, on the Tools heading.
export function MachineTools({ ctx }: { ctx: ToolContext }) {
  const programs = ctx.facts.programs ?? [];
  return (
    <div className="space-y-2">
      {ctx.tools
        .filter((t) => applies(t, programs))
        .map((t) => (
          <ToolCard key={t.id} tool={t} ctx={ctx} />
        ))}
    </div>
  );
}

// Add tool, beside the Tools heading: the tools the machine lacks only what Loskai can install,
// each saying what that is. Picking one installs it, in the terminal. Nothing to add, no button.
export function AddToolMenu({ ctx }: { ctx: ToolContext }) {
  const programs = ctx.facts.programs ?? [];
  const more = ctx.tools.filter((t) => addable(t, programs));
  if (more.length === 0) return null;
  return (
    <RowMenu
      label="Add tool"
      trigger={
        <>
          <Plus className="h-3.5 w-3.5" /> Add tool
        </>
      }
      triggerClass={BUTTON}
      items={more.map((t) => ({
        label: t.name,
        hint: `installs ${missing(t, programs).join(", ")}`,
        icon: <ToolIcon id={t.id} />,
        onClick: () => ctx.onRun({ tool: t.id, install: true, title: `Add ${t.name}` }),
      }))}
    />
  );
}

// The Tools button on a machine's row in the Machines tab: each added tool with how it
// stands there, opening it in a dialog. The machine's overview is read only while the menu
// is open — the Machines tab doesn't otherwise ask for it.
export function ToolsMenu({
  machineId,
  tools,
  className,
  onPick,
}: {
  machineId: string;
  tools: Tool[];
  className: string;
  onPick: (toolId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const facts = useFacts(machineId, open);
  const ssh = useSsh();
  const added = tools.filter((t) => !isStandard(t));
  if (added.length === 0) return null;

  const status = (t: Tool): string => {
    if (!facts.data) return "…";
    if (!facts.data.ok) return "";
    const programs = facts.data.programs ?? [];
    if (!applies(t, programs)) return addable(t, programs) ? "not added" : `needs ${missing(t, programs).join(", ")}`;
    const ctx = toolContext(machineId, tools, facts.data, ssh.data);
    return (ctx && toolSummary(t, ctx)) || "added";
  };

  return (
    <RowMenu
      label="Tools"
      trigger={<Wrench className="h-3.5 w-3.5" />}
      triggerClass={className}
      onOpenChange={setOpen}
      items={added.map((t) => ({
        label: t.name,
        hint: status(t),
        icon: <ToolIcon id={t.id} />,
        onClick: () => onPick(t.id),
      }))}
    />
  );
}

// An action that runs on a name typed for it — a new session, a new project. The server
// checks the name; it reaches the command as `$1`.
function Ask({ tool, action, onRun }: { tool: Tool; action: ToolAction; onRun: ToolStart }) {
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
