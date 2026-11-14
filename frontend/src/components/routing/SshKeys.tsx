import { useState } from "react";
import { KeyRound } from "lucide-react";

import { keyKind, keyUses, type KeyUse } from "../../lib/ssh";
import type { ToolContext, ToolStart } from "../../lib/toolRows";
import { hasKeys, type Tool, type ToolAction } from "../../lib/tools";
import { TOOL_BUTTON } from "../../lib/ui";
import { Overlay } from "../shared/Modal";
import { Ask } from "./ToolAsk";
import { ActionIcon } from "./ToolIcon";

const KIND_TITLE = {
  account: "On your GitHub or Forgejo account: reaches every repository you can. ssh offers it wherever no other key is named.",
  deploy: "On one repository only, for one project — its Own key, in its cog.",
  other: "A key of your own: used where ~/.ssh/config names it for a host.",
};


// Keys, in the card's header beside Settings, where a tool keeps the SSH user's keys (Git).
export function CardKeys({ tool, ctx }: { tool: Tool; ctx: ToolContext }) {
  const [open, setOpen] = useState(false);
  if (!hasKeys(tool)) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title="The SSH keys git uses here — which project uses which, where each goes, and deleting one"
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
      >
        <KeyRound className="h-3.5 w-3.5" /> Keys
      </button>
      {open && <SshKeys tool={tool} ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  );
}

// Every key in the SSH user's ~/.ssh, as the overview reads them (public halves only): what
// it is, which projects use it, its fingerprint — the one GitHub and Forgejo list — and its
// buttons: Show (where it goes), Test, Delete. Beside the list, what makes or tests one on
// no key (New account key, Test key). Each runs in the machine's terminal, this closing.
function SshKeys({ tool, ctx, onClose }: { tool: Tool; ctx: ToolContext; onClose: () => void }) {
  const keys = ctx.facts.ssh_keys;
  // Where each is used, through every remote in the home folder; null on an older line.
  const uses = keyUses(ctx.facts);
  // One ~/.ssh/config names is yours to take out: Delete leaves it alone.
  const named = new Set(ctx.facts.ssh_config_keys ?? []);
  const onKey = tool.actions.filter((a) => a.target === "key");
  const hasAccount = (keys ?? []).some((k) => keyKind(k.name) === "account");
  // New account key only while there is none.
  const beside = tool.actions.filter((a) => a.place === "keys" && !(a.id === "ssh-key" && hasAccount));
  const run: ToolStart = (r, a) => {
    onClose();
    ctx.onRun(r, a);
  };

  return (
    <Overlay
      onClose={onClose}
      label="SSH keys"
      className="flex max-h-full w-full max-w-3xl flex-col rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:max-h-[85vh]"
    >
      <h2 className="text-base font-semibold text-slate-100">SSH keys</h2>
      <p className="mt-1 text-sm text-slate-400">
        The keys git uses here, in the SSH user's ~/.ssh — read by their public halves only. An{" "}
        <span title={KIND_TITLE.account} className="cursor-help text-slate-200 underline decoration-dotted">account key</span>{" "}
        reaches every repository your account can; a{" "}
        <span title={KIND_TITLE.deploy} className="cursor-help text-slate-200 underline decoration-dotted">deploy key</span>{" "}
        one project's alone — its cog makes one.
      </p>
      <div className="mt-4 min-h-0 overflow-auto">
        {keys == null ? (
          <p className="text-sm text-amber-300">
            This machine's status line is older than this Loskai: install it again, in the machine's dialog, to list its keys.
          </p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-slate-500">No SSH key here yet.</p>
        ) : (
          <ul aria-label="Keys" className="divide-y divide-slate-800 rounded-lg border border-slate-800">
            {keys.map((k) => {
              const kind = keyKind(k.name);
              return (
                <li key={k.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                  <span className="min-w-0 sm:w-56">
                    <span className="font-mono text-slate-200">{k.name}</span>
                    <span title={KIND_TITLE[kind]} className="ml-2 cursor-help rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {kind}
                    </span>
                    <span title={`${k.type} ${k.bits} · ${k.comment}`} className="block truncate font-mono text-[11px] text-slate-500">
                      {k.fingerprint}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 text-slate-400">
                    <UsedBy uses={uses ? (uses.get(k.name) ?? []) : null} named={named.has(k.name)} />
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    {onKey.map((a) => (
                      <KeyButton
                        key={a.id}
                        tool={tool}
                        action={a}
                        name={k.name}
                        onRun={run}
                        kept={a.id === "delete-key" && named.has(k.name)}
                      />
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {beside.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {beside.map((a) =>
            a.ask ? (
              <Ask key={a.id} tool={tool} action={a} onRun={run} />
            ) : (
              <button
                key={a.id}
                type="button"
                title={a.description}
                onClick={() => run({ tool: tool.id, action: a.id, title: a.label }, a)}
                className={TOOL_BUTTON}
              >
                <ActionIcon tool={tool.id} action={a.id} className="h-3.5 w-3.5" /> {a.label}
              </button>
            ),
          )}
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          Close
        </button>
      </div>
    </Overlay>
  );
}

// Where a key is used: each remote it is for — a project's, or a submodule's, fetch or
// push — and whether ~/.ssh/config names it. A few shown; all in the tooltip.
function UsedBy({ uses, named }: { uses: KeyUse[] | null; named: boolean }) {
  if (!uses) return <span className="text-slate-500">install the status line again to see where it is used</span>;
  const line = (u: KeyUse) => `${u.repo}${u.module ? ` › ${u.module}` : ""} — ${u.way}`;
  const via = (u: KeyUse) => `${line(u)}: ${u.url}${u.hostname !== u.host ? ` (${u.host} → ${u.hostname})` : ""}`;
  const shown = uses.slice(0, 3);
  return (
    <span title={uses.map(via).join("\n") || undefined} className="block">
      {shown.map((u) => (
        <span key={`${u.repo}|${u.module}|${u.way}|${u.url}`} className="block truncate">
          {line(u)}
          {u.hostname !== u.host && <span className="text-slate-500"> · via {u.host}</span>}
        </span>
      ))}
      {uses.length > shown.length && <span className="block text-slate-500">and {uses.length - shown.length} more</span>}
      {named && (
        <span
          title="~/.ssh/config names it — for a remote above, or for logging in elsewhere"
          className="block cursor-help text-slate-500"
        >
          named in ~/.ssh/config
        </span>
      )}
      {uses.length === 0 && !named && <span className="text-slate-500">no remote here</span>}
    </span>
  );
}

// A key's button — rose for one that asks first (Delete); greyed, `kept`, for a Delete of a
// key ~/.ssh/config names.
function KeyButton({
  tool,
  action,
  name,
  onRun,
  kept = false,
}: {
  tool: Tool;
  action: ToolAction;
  name: string;
  onRun: ToolStart;
  kept?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={`${action.label} ${name}`}
      title={kept ? "~/.ssh/config names this key — take it out there first; Loskai doesn't edit that file" : action.description}
      disabled={kept}
      onClick={() => onRun({ tool: tool.id, action: action.id, target: name, title: `${action.label}: ${name}` }, action)}
      className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 ${
        action.confirm ? "border-rose-500/40 text-rose-300" : "border-slate-700 text-slate-200"
      }`}
    >
      <ActionIcon tool={tool.id} action={action.id} /> {action.label}
    </button>
  );
}
