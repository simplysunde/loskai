import { useState } from "react";
import { ExternalLink, KeyRound } from "lucide-react";

import { keyGroup, keyHost, keyKind, keyPage, keyUses, sshHost, type Facts, type KeyUse, type SshKeyInfo } from "../../lib/ssh";
import type { ToolContext, ToolStart } from "../../lib/toolRows";
import { askedOf, hasKeys, type Tool, type ToolAction } from "../../lib/tools";
import { TOOL_BUTTON } from "../../lib/ui";
import { CopyButton } from "../shared/CopyButton";
import { Overlay } from "../shared/Modal";
import { ActionIcon } from "./ToolIcon";

// The lists, each with a line saying what its keys are.
const GROUPS = [
  { id: "account", title: "Account keys", hint: "on your account, reaching every repository you can" },
  { id: "deploy", title: "Deploy keys", hint: "on one repository each — made in Project overrides" },
  { id: "other", title: "Other keys", hint: "neither, as far as Loskai can tell" },
] as const;


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

// Every key in the SSH user's ~/.ssh, as the overview reads them (public halves only), a
// card each: its name and what it is, in words; what it does — each remote it is for —
// written out in full; its comment and fingerprint; and its buttons: Copy and Add to …
// (from the page), Test and Delete (in the machine's terminal). Under the
// list, what makes or tests a key for a host. A run's terminal opens over it.
function SshKeys({ tool, ctx, onClose }: { tool: Tool; ctx: ToolContext; onClose: () => void }) {
  const keys = ctx.facts.ssh_keys;
  // Where each is used, through every remote in the home folder; null on an older line.
  const uses = keyUses(ctx.facts);
  // One ~/.ssh/config names is yours to take out: Delete leaves it alone.
  const named = new Set(ctx.facts.ssh_config_keys ?? []);
  const onKey = tool.actions.filter((a) => a.target === "key");
  const usesOf = (k: SshKeyInfo) => (uses ? (uses.get(k.name) ?? []) : null);
  // A key's own Test: that key on a host typed on its row (`<key>@<host>`).
  const onHost = tool.actions.find((a) => a.ask === "key-host");
  const hasAccount = (keys ?? []).some((k) => keyKind(k.name) === "account");
  // New account key only while there is none.
  const beside = tool.actions.filter(
    (a) => a.place === "keys" && a.ask !== "key-host" && !(a.id === "ssh-key" && hasAccount),
  );
  // Each runs in the machine's terminal, over this dialog, which stays: closing the terminal
  // comes back here, and the list follows what it did (the overview is read again then).
  const run = ctx.onRun;

  return (
    <Overlay
      onClose={onClose}
      label="SSH keys"
      className="flex max-h-full w-full max-w-3xl flex-col rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:max-h-[85vh]"
    >
      <h2 className="text-base font-semibold text-slate-100">SSH keys</h2>
      <p className="mt-1 text-sm text-slate-400">The keys of the user Loskai logs in as, in ~/.ssh — public halves only.</p>
      <div className="mt-4 min-h-0 overflow-auto">
        {keys == null ? (
          <p className="text-sm text-amber-300">
            This machine's status line is older than this Loskai: install it again, in the machine's dialog, to list its keys.
          </p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-slate-500">No SSH key here yet.</p>
        ) : (
          <div className="space-y-4">
            {GROUPS.map((g) => {
              const inIt = keys.filter((k) => keyGroup(k, usesOf(k)).group === g.id);
              if (inIt.length === 0 && g.id === "other") return null;
              return (
                <section key={g.id} aria-label={g.title}>
                  <h3 className="text-xs font-medium text-slate-200">
                    {g.title} <span className="font-normal text-slate-500">— {g.hint}</span>
                  </h3>
                  {inIt.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-500">None.</p>
                  ) : (
                    <ul className="mt-1.5 divide-y divide-slate-800 rounded-lg border border-slate-800">
                      {inIt.map((k) => (
                        <KeyRow
                          key={k.name}
                          info={k}
                          uses={usesOf(k)}
                          named={named.has(k.name)}
                          facts={ctx.facts}
                          actions={onKey}
                          tool={tool}
                          onRun={run}
                          test={onHost}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
      {beside.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* What asks for the same kind of value shares one field: a host, for New key for a
              host, Test key and Try every key. */}
          <span className="text-xs text-slate-400">For a host:</span>
          {[...new Set(beside.flatMap((a) => (a.ask ? [a.ask] : [])))].map((kind) => (
            <AskGroup key={kind} tool={tool} actions={beside.filter((a) => a.ask === kind)} onRun={run} />
          ))}
          {beside.map((a) =>
            a.ask ? null : (
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

// A key, in two columns: on the left its name and tags, what it does, and its comment,
// fingerprint and where to add it; on the right, top-aligned, the same buttons on every row
// — Copy, Test, Delete — so they line up down the list.
function KeyRow({
  info,
  uses,
  named,
  facts,
  actions,
  tool,
  onRun,
  test,
}: {
  info: SshKeyInfo;
  uses: KeyUse[] | null;
  named: boolean;
  facts: Facts;
  actions: ToolAction[];
  tool: Tool;
  onRun: ToolStart;
  test?: ToolAction;
}) {
  const { group, tag } = keyGroup(info, uses);
  const page = info.public ? keyPage(info, uses) : null;
  return (
    <li className="flex gap-3 px-3 py-2 text-xs max-sm:flex-col">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm text-slate-100">{info.name}</span>
          {tag && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">{tag}</span>}
          {named && (
            <span title="~/.ssh/config names it — Delete leaves it alone" className="cursor-help rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
              ~/.ssh/config
            </span>
          )}
        </div>
        <UsedBy uses={uses} named={named} account={group === "account"} facts={facts} />
        {/* Its comment says what it is for and travels with the key; its fingerprint is the
            one GitHub and Forgejo list beside a key; then where to paste it. */}
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-slate-500">
          <span className="min-w-0 truncate">
            {info.comment && `${info.comment} · `}
            <span title={`${info.type} ${info.bits}: ${info.fingerprint}`} className="cursor-help font-mono">
              {info.fingerprint.slice(0, 19)}…
            </span>
          </span>
          {page && (
            <a
              href={page.url}
              target="_blank"
              rel="noreferrer"
              title={`Open ${page.where}: ${page.url}`}
              className="flex shrink-0 items-center gap-0.5 text-teal-400 hover:underline"
            >
              · {page.label} <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-start gap-1 max-sm:justify-end">
        <CopyKey info={info} page={page} />
        {test && <KeyTest tool={tool} action={test} name={info.name} start={keyHost(info, uses) ?? ""} onRun={onRun} />}
        {actions.map((a) => (
          <KeyButton key={a.id} tool={tool} action={a} name={info.name} onRun={onRun} off={offWhy(a, named)} />
        ))}
      </div>
    </li>
  );
}

// What a key does, in a line a remote: fetches or pushes which repository (› submodule), on
// which platform, through which ~/.ssh/config alias. Unused, a word on why.
function UsedBy({ uses, named, account, facts }: { uses: KeyUse[] | null; named: boolean; account: boolean; facts: Facts }) {
  if (!uses) return <p className="mt-0.5 text-slate-500">Install the status line again to see where it's used.</p>;
  if (uses.length === 0) {
    // Only git's use of it is seen: it may be on an account, or log in elsewhere — so the
    // line says which remotes don't use it, and why, not that it is useless.
    const ssh = (facts.remotes ?? []).some((r) => sshHost(r.url));
    const why = named
      ? "~/.ssh/config names it for a host no project here uses."
      : !account
        ? "No remote here names it."
        : ssh
          ? "The remotes here over SSH each use a key of their own; the rest are over HTTP(S), which needs none."
          : "The remotes here are over HTTP(S), which needs no key.";
    return (
      <p title={`${why} It may still be on your account, or log in elsewhere: Loskai sees only git here.`} className="mt-0.5 w-fit cursor-help text-slate-500">
        No git remote here uses it
      </p>
    );
  }
  const verb = { "fetch and push": "Fetches and pushes", fetch: "Fetches", push: "Pushes" } as const;
  return (
    <div className="mt-0.5 text-slate-300">
      {uses.map((u) => (
        <p key={`${u.repo}|${u.module}|${u.way}|${u.url}`} title={u.url} className="break-words">
          {verb[u.way]} <span className="font-mono">{u.repo}{u.module && ` › ${u.module}`}</span>
          <span className="text-slate-500">
            {" · "}
            {u.hostname}
            {u.hostname !== u.host && ` via ${u.host}`}
          </span>
          {u.offered && (
            <span title={`One of several keys ssh offers there — Test key with ${u.host} says which gets in`} className="cursor-help text-amber-300/80">
              {" · offered"}
            </span>
          )}
        </p>
      ))}
    </div>
  );
}

// Why a key's button is greyed, or null: Delete of a key ~/.ssh/config names — that file is
// yours.
function offWhy(action: ToolAction, named: boolean): string | null {
  if (action.id === "delete-key" && named) return "~/.ssh/config names this key — take it out there first; Loskai doesn't edit that file";
  return null;
}

// A key's button — rose for one that asks first (Delete); greyed, saying why, when `off`.
function KeyButton({
  tool,
  action,
  name,
  onRun,
  off = null,
}: {
  tool: Tool;
  action: ToolAction;
  name: string;
  onRun: ToolStart;
  off?: string | null;
}) {
  return (
    <button
      type="button"
      aria-label={`${action.label} ${name}`}
      title={off ?? action.description}
      disabled={off != null}
      onClick={() => onRun({ tool: tool.id, action: action.id, target: name, title: `${action.label}: ${name}` }, action)}
      className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 ${
        action.confirm ? "border-rose-500/40 text-rose-300" : "border-slate-700 text-slate-200"
      }`}
    >
      <ActionIcon tool={tool.id} action={action.id} /> {action.label}
    </button>
  );
}

// One field for the actions that ask for the same kind of value, a button each — Enter
// runs none, since which is meant only its button says.
function AskGroup({ tool, actions, onRun }: { tool: Tool; actions: ToolAction[]; onRun: ToolStart }) {
  const [value, setValue] = useState("");
  const asked = askedOf(actions[0].ask);
  const v = value.trim();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        aria-label={asked.what.replace(/^./, (c) => c.toUpperCase())}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={asked.placeholder}
        className={`${asked.width} min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200`}
      />
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          disabled={!v}
          title={a.description}
          onClick={() => onRun({ tool: tool.id, action: a.id, target: v, title: `${a.label}: ${v}` }, a)}
          className={TOOL_BUTTON}
        >
          <ActionIcon tool={tool.id} action={a.id} className="h-3.5 w-3.5" /> {a.label}
        </button>
      ))}
    </div>
  );
}

// Copy: the key's public line on the clipboard, ready to paste where it goes — read from the
// overview, so nothing runs on the machine. Its comment goes with it: Forgejo names a key by
// it.
function CopyKey({ info, page }: { info: SshKeyInfo; page: { where: string } | null }) {
  if (!info.public) {
    return (
      <span title="The status line is older: install it again to copy keys from here" className="cursor-help px-1.5 py-0.5 text-[11px] text-slate-600">
        Copy —
      </span>
    );
  }
  return (
    <CopyButton
      text={info.comment ? `${info.public} ${info.comment}` : info.public}
      title={`Copy ${info.name}'s public key${page ? ` — then paste it into ${page.where}` : ""}`}
      label={`Copy ${info.name}`}
      shown="Copy"
      className="flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800 [&_svg]:h-2.5 [&_svg]:w-2.5"
    />
  );
}

// A key's own Test: a host — filled with the platform it is for, when that can be told — and
// the button that tries the key alone there. The host is yours to change: where it came from.
function KeyTest({
  tool,
  action,
  name,
  start,
  onRun,
}: {
  tool: Tool;
  action: ToolAction;
  name: string;
  start: string;
  onRun: ToolStart;
}) {
  const [host, setHost] = useState(start);
  const h = host.trim();
  const go = () => h && onRun({ tool: tool.id, action: action.id, target: `${name}@${h}`, title: `Test: ${name} on ${h}` }, action);
  return (
    <span className="flex items-center">
      <input
        aria-label={`Host to test ${name} on`}
        value={host}
        onChange={(e) => setHost(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        placeholder="host"
        className="w-28 min-w-0 rounded-l-md border border-r-0 border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600"
      />
      <button
        type="button"
        aria-label={`Test ${name}`}
        disabled={!h}
        title={h ? `Try ${name} alone on ${h}` : "Type the host it is for — github.com, your Forgejo's"}
        onClick={go}
        className="flex items-center gap-1 rounded-r-md border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-40"
      >
        <ActionIcon tool={tool.id} action={action.id} /> {action.label}
      </button>
    </span>
  );
}
