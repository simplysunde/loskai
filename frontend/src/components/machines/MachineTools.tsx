import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";

import { SELF_UPDATING_REASON, tailscaleState, updatesItself, useFacts, useSsh, type Facts } from "../../lib/ssh";
import { ActionIcon, ToolIcon } from "./ToolIcon";
import { isLive, listsOf, runningCount, toolContext, toolSummary, waitsOnYou, type ToolContext, type ToolStart } from "../../lib/toolRows";
import {
  addable,
  applies,
  commandFor,
  hasCardSettings,
  isStandard,
  MACHINE_TOOL,
  missing,
  isOnCard,
  rowSettingsOf,
  type Tool,
  type ToolAction,
  type TargetKind,
} from "../../lib/tools";
import { RowMenu } from "../shared/RowMenu";
import { IconButton } from "../shared/IconButton";
import { SettingRow, Switch } from "../shared/SettingRow";
import { CardSettings, GitIdentity, ToolSettingsButton, ToolSettingsDialog } from "./ToolSettings";
import { ToolAsk } from "./ToolAsk";
import { CardKeys } from "./SshKeys";
import { TOOL_BUTTON } from "../../lib/ui";
import { Hint, ReasonButton } from "../shared/Hint";
import { useWaiting, waitingKey } from "../../lib/waiting";

const BUTTON = TOOL_BUTTON;

// A row's button — and, under a list, the tool's own (Pull all), so they line up as one column.
const ROW_BUTTON =
  "flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-40 aria-disabled:opacity-40";

// The buttons the tools that apply put on a row of `kind` — a card's, or the Running list's:
// small bordered ones, in rose for those that ask first (Stop). One with a `when` is there
// only while the row's session is running, or only while it isn't, as `facts` says — the
// rest of the time hidden (Start and Stop, taking turns in one place) or, with `otherwise:
// disabled`, greyed (Attach), so every row keeps the same buttons in the same places.
// A Start that failed while its session went on running stopped at a question there (Claude's
// "trust this folder?"): the button that opens the session is amber until a button on the
// row is clicked — remembered in this browser, so a reload keeps it.
export function RowButtons({
  machine,
  here,
  kind,
  name,
  onRun,
  facts,
}: {
  machine: string;
  here: Tool[];
  kind: TargetKind;
  name: string;
  onRun: ToolStart;
  facts?: Facts;
}) {
  const { waiting, mark, clear } = useWaiting();
  const live = (t: Tool) => facts !== undefined && isLive(t, kind, name, facts);
  const fits = (t: Tool, a: ToolAction) => !a.when || (facts !== undefined && (a.when === "running") === live(t));
  return here.flatMap((tool) => {
    const key = waitingKey(machine, tool.id, kind, name);
    const asks = waiting(key) && live(tool);
    return tool.actions
      .filter((a) => a.target === kind && isOnCard(a) && (fits(tool, a) || a.otherwise === "disabled"))
      .map((a) => {
        const opens = asks && a.when === "running" && !!a.session;
        return (
          <ReasonButton
            key={`${tool.id}-${a.id}`}
            reason={fits(tool, a) ? null : a.when === "running" ? "Not running — Start it first" : "Running — Stop it first"}
            title={opens ? `It asks something first — ${a.label} to answer it` : `${a.description}\n$ ${typeof a.run === "string" ? a.run : ""}`.trim()}
            onClick={() => {
              clear(key);
              onRun({ tool: tool.id, action: a.id, target: name, title: `${a.label} ${name}` }, a, (ok) => {
                if (!ok && a.when === "stopped") mark(key);
              });
            }}
            className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] aria-disabled:opacity-40 aria-disabled:hover:bg-transparent ${
              opens
                ? "border-amber-500/60 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                : `border-slate-700 hover:bg-slate-800 ${a.confirm ? "text-rose-300" : "text-slate-200"}`
            }`}
          >
            <ActionIcon tool={tool.id} action={a.id} />
            {a.label}
          </ReasonButton>
        );
      });
  });
}

// A tool's actions on the machine itself (Update, Pull all): small like a row's buttons, at a
// list's foot — else a card's size, as System's beside the overview.
export function OwnButtons({ tool, ctx, small = false }: { tool: Tool; ctx: ToolContext; small?: boolean }) {
  const manager = ctx.facts.updates?.manager ?? null;
  return tool.actions
    .filter((a) => !a.target && !a.ask && isOnCard(a))
    .map((a) => {
      const command = commandFor(a, manager);
      return (
        <ReasonButton
          key={a.id}
          reason={command ? null : updatesItself(ctx.facts) ? SELF_UPDATING_REASON : `No command for ${manager ?? "this machine"}'s package manager`}
          title={`${a.description}\n$ ${command}`}
          onClick={() => ctx.onRun({ tool: tool.id, action: a.id, title: a.label }, a)}
          className={small ? ROW_BUTTON : BUTTON}
        >
          <ActionIcon tool={tool.id} action={a.id} className={small ? undefined : "h-3.5 w-3.5"} /> {a.label}
        </ReasonButton>
      );
    });
}

// One tool, as a card: its lists with their row buttons, its machine actions, and the
// actions that ask for a name. Null when it has nothing to show here — Services' buttons
// are all on the Running list's rows.
export function ToolCard({ tool, ctx, titled = true }: { tool: Tool; ctx: ToolContext; titled?: boolean }) {
  // What a dialog offers instead — its Settings, its Keys — isn't on the card.
  const own = tool.actions.filter((a) => !a.target && !a.ask && isOnCard(a));
  const asks = tool.actions.filter((a) => a.ask && isOnCard(a));
  const lists = listsOf(tool, ctx);
  // The row whose own settings are open in a dialog.
  const [open, setOpen] = useState<{ kind: TargetKind; name: string } | null>(null);
  if (own.length + asks.length + lists.length === 0 && !hasCardSettings(tool)) return null;
  const tailscale = tool.id === "tailscale";
  const askFields = asks.map((a) => <ToolAsk key={a.id} tool={tool} action={a} onRun={ctx.onRun} />);
  return (
    <div className="rounded-lg border border-slate-800 px-3 py-2">
      {/* Its settings (Git's name, email and projects folder) behind the cog on the right. */}
      {titled && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex w-fit min-w-0 items-center gap-2 text-sm text-slate-100">
            <ToolIcon id={tool.id} className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <Hint text={tool.description}>{tool.name}</Hint>
            {!isStandard(tool) && (
              <span className="truncate text-xs text-slate-500">
                {toolSummary(tool, ctx)}
                <GitIdentity tool={tool} ctx={ctx} />
              </span>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            <CardKeys tool={tool} ctx={ctx} />
            <CardSettings tool={tool} ctx={ctx} />
          </span>
        </div>
      )}
      {tailscale && <TailscaleSettings tool={tool} ctx={ctx} />}
      {lists.map(({ kind, rows }, i) => (
        <div key={kind} className="mt-2">
          {/* On a wider screen a grid, so every row's buttons start in one column — and the
              foot's (Pull all) under them. On a phone each row's are under its name. */}
          <ul className="space-y-1.5 text-xs text-slate-300 sm:grid sm:grid-flow-row-dense sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-2 sm:gap-y-1.5 sm:space-y-0">
            {rows.length === 0 && <li className="text-slate-500 sm:col-span-2">None yet.</li>}
            {rows.map((r) => (
              <li key={r.name} className="flex flex-col gap-1 sm:contents">
                <span title={r.title} className="min-w-0">
                  <span className="break-all font-mono">{r.name}</span>
                  {isLive(tool, kind, r.name, ctx.facts) && <span className="ml-2 text-emerald-300">running</span>}
                  <span className="block truncate text-slate-500">{r.detail}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  <RowButtons machine={ctx.machineId} here={[tool]} kind={kind} name={r.name} onRun={ctx.onRun} facts={ctx.facts} />
                  {rowSettingsOf(tool, kind).length > 0 && (
                    <ToolSettingsButton tool={tool} ctx={ctx} row={{ kind, name: r.name }} onOpen={() => setOpen({ kind, name: r.name })} />
                  )}
                </span>
              </li>
            ))}
            {/* The last list's foot: the tool's own actions in the buttons' column, what asks
                for a name (Clone) beside them — on a phone, under them. */}
            {i === lists.length - 1 && !tailscale && (own.length > 0 || asks.length > 0) && (
              <li className="flex flex-col gap-2 pt-1 sm:contents">
                {own.length > 0 && <span className="flex flex-wrap items-center gap-1 sm:col-start-2 sm:mt-1"><OwnButtons tool={tool} ctx={ctx} small /></span>}
                {asks.length > 0 && <span className="flex flex-wrap items-center gap-2 sm:col-start-1 sm:mt-1">{askFields}</span>}
              </li>
            )}
          </ul>
        </div>
      ))}
      {open && <ToolSettingsDialog tool={tool} ctx={ctx} row={open} onClose={() => setOpen(null)} />}
      {lists.length === 0 && !tailscale && (own.length > 0 || asks.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <OwnButtons tool={tool} ctx={ctx} />
          {askFields}
        </div>
      )}
    </div>
  );
}

const TAILSCALE_ADMIN = "https://console.tailscale.com/admin";
const OUT_LINK = "text-teal-400 hover:text-teal-300 hover:underline";

function TailscaleAdminLink({ path, title, children }: { path: string; title: string; children: ReactNode }) {
  return (
    <a href={`${TAILSCALE_ADMIN}/${path}`} target="_blank" rel="noreferrer" title={title} className={OUT_LINK}>
      {children}
    </a>
  );
}

// Tailscale's card is two settings rather than a row of buttons: whether the machine is on
// the tailnet, and whether it shares its network — each a switch that runs the tool's own
// action (up/down, share/unshare) and moves once the overview reads the change back. Below
// them, folded, the rest of the tailnet. Approving a device or a network, and split DNS, are
// in Tailscale's admin console: Loskai holds no Tailscale key to do them.
function TailscaleSettings({ tool, ctx }: { tool: Tool; ctx: ToolContext }) {
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
    const a = tool.actions.find((x) => x.id === id);
    if (a) ctx.onRun({ tool: tool.id, action: a.id, title: a.label }, a);
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
              <TailscaleAdminLink path="machines" title="Network › Machines › this device › Approve">Approve</TailscaleAdminLink>
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
                      <TailscaleAdminLink
                        path="dns"
                        title="Your names away from home also need split DNS: a nameserver for your AdGuard, restricted to your base domain"
                      >
                        Split DNS
                      </TailscaleAdminLink>
                    </span>
                  ) : (
                    <span key={net} className="text-amber-300">
                      <span className="font-mono">{net}</span> waiting for approval ·{" "}
                      <TailscaleAdminLink
                        path="machines"
                        title="Network › Machines › this machine › Subnets: approve it under Awaiting Approval. Disable key expiry on its ⋯ menu too."
                      >
                        Approve
                      </TailscaleAdminLink>
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
                <li key={d.ip} className="flex items-center justify-between gap-2">
                  <span title={`${d.os} · ${d.status}`} className="flex min-w-0 items-center gap-2">
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

// A set-up machine's row: a button per tool it has, beyond the standard ones (System's
// Update is in the row's More), in the tools' order, each opening its dialog and saying how it
// stands in its title, a small count of its running sessions, amber where something waits on
// you (`waitsOnYou`). From the machine's overview, read for the row and not polled: until it
// answers, or where it can't be read, the row has none. Adding one is the machine's dialog's.
export function RowTools({
  machineId,
  tools,
  onPick,
}: {
  machineId: string;
  tools: Tool[];
  onPick: (toolId: string) => void;
}) {
  const facts = useFacts(machineId, true, false);
  const ssh = useSsh();
  const { waiting } = useWaiting();
  if (!facts.data?.ok) return null;
  const programs = facts.data.programs ?? [];
  const ctx = toolContext(machineId, tools, facts.data, ssh.data);
  return (
    <>
      {tools
        .filter((t) => !isStandard(t) && applies(t, programs))
        .map((t) => {
          const waits = ctx && waitsOnYou(t, ctx, waiting);
          const said = waits || (ctx && toolSummary(t, ctx));
          return (
            <IconButton
              key={t.id}
              title={said ? `${t.name} — ${said}` : t.name}
              tone={waits ? "warn" : "plain"}
              count={ctx ? runningCount(t, ctx) : 0}
              onClick={() => onPick(t.id)}
            >
              <ToolIcon id={t.id} />
            </IconButton>
          );
        })}
    </>
  );
}

