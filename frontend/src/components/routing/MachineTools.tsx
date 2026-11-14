import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus, Wrench } from "lucide-react";

import { tailscaleState, useFacts, useSsh } from "../../lib/ssh";
import { ActionIcon, ToolIcon } from "./ToolIcon";
import { isLive, listsOf, toolContext, toolSummary, type ToolContext, type ToolStart } from "../../lib/toolRows";
import {
  addable,
  applies,
  commandFor,
  isStandard,
  MACHINE_TOOL,
  missing,
  rowSettingsOf,
  type Tool,
  type ToolAction,
  type ToolTarget,
} from "../../lib/tools";
import { RowMenu } from "../shared/RowMenu";
import { SettingRow, Switch } from "../shared/SettingRow";
import { RowSettingsButton, RowSettingsDialog, ToolSettings } from "./ToolSettings";

const BUTTON =
  "flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent";

// A row's button — and, under a list, the tool's own (Pull all), so they line up as one column.
const ROW_BUTTON =
  "flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-40";

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

// A tool's actions on the machine itself (Update, Pull all): small like a row's buttons, at a
// list's foot — else a card's size, as System's beside the overview.
export function OwnButtons({ tool: t, ctx, small = false }: { tool: Tool; ctx: ToolContext; small?: boolean }) {
  const manager = ctx.facts.updates?.manager ?? null;
  return t.actions
    .filter((a) => !a.target && !a.ask)
    .map((a) => {
      const command = commandFor(a, manager);
      return (
        <button
          key={a.id}
          disabled={!command}
          title={command ? `${a.description}\n$ ${command}` : `No command for ${manager ?? "this machine"}'s package manager`}
          onClick={() => ctx.onRun({ tool: t.id, action: a.id, title: a.label }, a)}
          className={small ? ROW_BUTTON : BUTTON}
        >
          <ActionIcon tool={t.id} action={a.id} className={small ? undefined : "h-3.5 w-3.5"} /> {a.label}
        </button>
      );
    });
}

// One tool, as a card: its lists with their row buttons, its machine actions, and the
// actions that ask for a name. Null when it has nothing to show here — Services' buttons
// are all on the Running list's rows.
export function ToolCard({ tool: t, ctx, titled = true }: { tool: Tool; ctx: ToolContext; titled?: boolean }) {
  const own = t.actions.filter((a) => !a.target && !a.ask);
  const asks = t.actions.filter((a) => a.ask);
  const lists = listsOf(t, ctx);
  // The row whose own settings are open in a dialog.
  const [open, setOpen] = useState<{ kind: ToolTarget; name: string } | null>(null);
  // Git's card holds the projects folder even without settings of its own.
  const settings = (t.settings?.length ?? 0) > 0 || t.id === "git";
  if (own.length + asks.length + lists.length === 0 && !settings) return null;
  const tailscale = t.id === "tailscale";
  const askFields = asks.map((a) => <Ask key={a.id} tool={t} action={a} onRun={ctx.onRun} />);
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
      {tailscale && <TailscaleSettings tool={t} ctx={ctx} />}
      {lists.map(({ kind, rows }, i) => (
        <div key={kind} className="mt-2">
          {/* On a wider screen a grid, so every row's buttons start in one column — and the
              foot's (Pull all) under them. On a phone each row's are under its name. */}
          <ul className="space-y-1.5 text-xs text-slate-300 sm:grid sm:grid-flow-row-dense sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-2 sm:gap-y-1.5 sm:space-y-0">
            {rows.length === 0 && <li className="text-slate-500 sm:col-span-2">None yet.</li>}
            {rows.map((r) => (
              <li key={r.name} title={r.title} className="flex flex-col gap-1 sm:contents">
                <span className="min-w-0">
                  <span className="break-all font-mono">{r.name}</span>
                  {isLive(t, kind, r.name, ctx.facts) && <span className="ml-2 text-emerald-300">running</span>}
                  <span className="block truncate text-slate-500">{r.detail}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  <RowButtons here={[t]} kind={kind} name={r.name} onRun={ctx.onRun} />
                  {rowSettingsOf(t, kind).length > 0 && (
                    <RowSettingsButton tool={t} ctx={ctx} kind={kind} name={r.name} onOpen={() => setOpen({ kind, name: r.name })} />
                  )}
                </span>
              </li>
            ))}
            {/* The last list's foot: the tool's own actions in the buttons' column, what asks
                for a name (Clone) beside them — on a phone, under them. */}
            {i === lists.length - 1 && !tailscale && (own.length > 0 || asks.length > 0) && (
              <li className="flex flex-col gap-2 pt-1 sm:contents">
                {own.length > 0 && <span className="flex flex-wrap items-center gap-1 sm:col-start-2 sm:mt-1"><OwnButtons tool={t} ctx={ctx} small /></span>}
                {asks.length > 0 && <span className="flex flex-wrap items-center gap-2 sm:col-start-1 sm:mt-1">{askFields}</span>}
              </li>
            )}
          </ul>
        </div>
      ))}
      {open && <RowSettingsDialog tool={t} ctx={ctx} kind={open.kind} name={open.name} onClose={() => setOpen(null)} />}
      {lists.length === 0 && !tailscale && (own.length > 0 || asks.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <OwnButtons tool={t} ctx={ctx} />
          {askFields}
        </div>
      )}
    </div>
  );
}

const ADMIN = "https://login.tailscale.com/admin";
const OUT_LINK = "text-teal-400 hover:text-teal-300 hover:underline";

function AdminLink({ path, title, children }: { path: string; title: string; children: ReactNode }) {
  return (
    <a href={`${ADMIN}/${path}`} target="_blank" rel="noreferrer" title={title} className={OUT_LINK}>
      {children}
    </a>
  );
}

// Tailscale's card is two settings rather than a row of buttons: whether the machine is on
// the tailnet, and whether it shares its network — each a switch that runs the tool's own
// action (up/down, share/unshare) and moves once the overview reads the change back. Below
// them, folded, the rest of the tailnet. Approving a device or a network, and split DNS, are
// in Tailscale's admin console: Loskai holds no Tailscale key to do them.
function TailscaleSettings({ tool: t, ctx }: { tool: Tool; ctx: ToolContext }) {
  const [open, setOpen] = useState(false);
  const self = ctx.facts.tailscale_self;
  const ip = ctx.facts.tailscale ?? null;
  const state = tailscaleState(ctx.facts);
  const up = state === "on" || state === "approval";
  const shared = self?.shared ?? [];
  const others = (ctx.facts.tailnet ?? []).filter((d) => !d.self);
  const online = others.filter((d) => d.online).length;
  const name = ctx.facts.tailnet?.find((d) => d.self)?.name;
  const run = (id: string) => {
    const a = t.actions.find((x) => x.id === id);
    if (a) ctx.onRun({ tool: t.id, action: a.id, title: a.label }, a);
  };

  return (
    <div className="mt-1 divide-y divide-slate-800">
      <SettingRow
        label="Connected"
        description={
          state === "on" ? (
            <span className="font-mono text-slate-400">
              {ip}
              {name && <span className="font-sans text-slate-500"> · {name}</span>}
            </span>
          ) : state === "approval" ? (
            <span className="text-amber-300">
              Waiting for your tailnet to approve this device ·{" "}
              <AdminLink path="machines" title="Machines › this device › Approve">Approve</AdminLink>
            </span>
          ) : state === "login" ? (
            <span className="text-amber-300">Logged out — connecting shows a link to log in</span>
          ) : (
            "Off"
          )
        }
      >
        <Switch
          label="Connected"
          checked={up}
          title={up ? "Disconnect: take this machine off the tailnet" : "Connect: bring Tailscale up, in its terminal"}
          onChange={() => run(up ? "down" : "up")}
        />
      </SettingRow>
      {/* A line before v9 doesn't say what it shares: no switch that could only guess. */}
      {state === "on" && !self && (
        <SettingRow
          label="Share this network"
          description="Its status line is older than this Loskai: Install again, under SSH, to see and change it"
        />
      )}
      {state === "on" && self && (
        <SettingRow
          label="Share this network"
          description={
            shared.length === 0 ? (
              "Your devices reach this machine's network from anywhere"
            ) : (
              <span className="flex flex-wrap gap-x-3">
                {shared.map((net) =>
                  self.approved.includes(net) ? (
                    <span key={net}>
                      <span className="font-mono text-slate-400">{net}</span> ·{" "}
                      <AdminLink
                        path="dns"
                        title="Your names away from home also need split DNS: a nameserver for your AdGuard, restricted to your base domain"
                      >
                        Split DNS
                      </AdminLink>
                    </span>
                  ) : (
                    <span key={net} className="text-amber-300">
                      <span className="font-mono">{net}</span> waiting for approval ·{" "}
                      <AdminLink
                        path="machines"
                        title="Machines › this machine's ⋯ menu › Edit route settings — approve it. Disable key expiry there too."
                      >
                        Approve
                      </AdminLink>
                    </span>
                  ),
                )}
              </span>
            )
          }
        >
          <Switch
            label="Share this network"
            checked={shared.length > 0}
            title={shared.length > 0 ? "Stop sharing it" : "Share the network this machine is on: asks for sudo's password"}
            onChange={() => run(shared.length > 0 ? "unshare" : "share")}
          />
        </SettingRow>
      )}
      {up && others.length > 0 && (
        <div className="pt-2">
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Tailnet · {others.length} other {others.length === 1 ? "device" : "devices"}, {online} online
          </button>
          {open && (
            <ul className="mt-1.5 space-y-1 pl-5 text-xs text-slate-300">
              {others.map((d) => (
                <li key={d.ip} title={`${d.os} · ${d.status}`} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${d.online ? "bg-emerald-400" : "bg-slate-600"}`} />
                    <span className="truncate font-mono">{d.name}</span>
                  </span>
                  <span className="shrink-0 font-mono text-slate-500">{d.ip}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// A machine's tools, in its dialog: a card for each that applies here. The ones Loskai can
// add are behind Add tool, on the Tools heading.
export function MachineTools({ ctx }: { ctx: ToolContext }) {
  const programs = ctx.facts.programs ?? [];
  return (
    <div className="space-y-2">
      {ctx.tools
        .filter((t) => applies(t, programs) && t.id !== MACHINE_TOOL)
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
// What an asked-for value looks like, in its field: a name, or (Clone) a repository's address.
const ASKED: Partial<Record<ToolTarget, { placeholder: string; width: string; what: string }>> = {
  repo: { placeholder: "https://… or git@host:path", width: "w-56", what: "repository" },
};

function Ask({ tool, action, onRun }: { tool: Tool; action: ToolAction; onRun: ToolStart }) {
  const [name, setName] = useState("");
  const asked = (action.ask && ASKED[action.ask]) || { placeholder: "name", width: "w-32", what: "name" };
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onRun({ tool: tool.id, action: action.id, target: name.trim(), title: `${action.label}: ${name.trim()}` }, action);
        // One that asks first keeps the name, so a Cancel there loses nothing.
        if (!action.confirm) setName("");
      }}
    >
      <input
        aria-label={`${action.label} — ${asked.what}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={asked.placeholder}
        className={`${asked.width} min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200`}
      />
      <button type="submit" disabled={!name.trim()} title={`${action.description}\n$ ${typeof action.run === "string" ? action.run : ""}`} className={BUTTON}>
        <Plus className="h-3.5 w-3.5" /> {action.label}
      </button>
    </form>
  );
}
