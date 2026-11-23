import { useRef, useState } from "react";
import { Check, ExternalLink, KeyRound, RotateCw, Tag, X } from "lucide-react";

import { commentText, keyGroup, keyHost, keyKind, keyLabel, keyPage, keyUses, usesOfKey, remoteSshHost, useSsh, type Facts, type KeyUse, type MachineKey } from "../../lib/ssh";
import type { ToolContext, ToolStart } from "../../lib/toolRows";
import { useRecentHosts } from "../../lib/recentHosts";
import { hasKeys, type Tool, type ToolAction } from "../../lib/tools";
import { CopyButton } from "../shared/CopyButton";
import { Overlay } from "../shared/Modal";
import { ActionIcon } from "./ToolIcon";
import { AddSite, AddToSite } from "./AddToSite";
import { Hint, ReasonButton } from "../shared/Hint";

// A key's Test, as it last came out while Keys is open: the host, and whether it got in.
type Tested = { host: string; ok: boolean };

// Keys, in Git's card header beside Settings: git's view of the machine's keys.
export function CardKeys({ tool, ctx }: { tool: Tool; ctx: ToolContext }) {
  const [open, setOpen] = useState(false);
  if (!hasKeys(tool)) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title="The keys git uses here — which remotes use which, testing one on a host, where to add it"
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
      >
        <KeyRound className="h-3.5 w-3.5" /> Keys
      </button>
      {open && <SshKeys tool={tool} ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  );
}

// The lists, each with a line saying what its keys are: git's two, then those nothing says
// are git's yet. A login key — labelled for logging in to other computers — is neither git's
// nor Loskai's, so it isn't listed.
const GROUPS = [
  { id: "account", title: "Account keys", hint: "on your account, reaching every repository you can" },
  { id: "deploy", title: "Deploy keys", hint: "on one repository each — made in Project overrides" },
  { id: "other", title: "Not used by git yet", hint: "no remote uses them, and no label says — Label one that is git's" },
] as const;



// Git's keys in the SSH user's ~/.ssh, as the overview reads them (public halves only), a
// card each: its name; what it does — each remote it is for — written out in full; its
// comment and fingerprint; and its buttons: Copy and Add to … (from the page), Test, Label and
// Delete (in the machine's terminal). Under the lists, Add SSH key. A run's terminal opens
// over it. The machine's other keys aren't Loskai's business; its own key is SSH setup's.
export function SshKeys({ tool, ctx, onClose }: { tool: Tool; ctx: ToolContext; onClose: () => void }) {
  const keys = ctx.facts.ssh_keys;
  // Where each is used, through every remote in the home folder; null on an older line.
  const uses = keyUses(ctx.facts);
  // One ~/.ssh/config names is yours to take out: Delete leaves it alone.
  const inSshConfig = new Set(ctx.facts.ssh_config_keys ?? []);
  // A key it names that Keys can't find — no .pub: gone, ssh offers nothing in its place where
  // IdentitiesOnly says so. A private key without its .pub may still be there, so it says only that.
  const missing = keys ? [...inSshConfig].filter((n) => !keys.some((k) => k.name === n)) : [];
  const keyActions = tool.actions.filter((a) => a.target === "key");
  const usesOf = (k: MachineKey) => usesOfKey(ctx.facts, uses, k.name);
  const list = (ks: MachineKey[]) => (
    <ul className="mt-1.5 divide-y divide-slate-800 rounded-lg border border-slate-800">
      {ks.map((k) => (
        <KeyRow
          key={k.name}
          info={k}
          uses={usesOf(k)}
          inSshConfig={inSshConfig.has(k.name)}
          facts={ctx.facts}
          actions={keyActions.filter((a) => a.id === "delete-key")}
          tool={tool}
          onRun={run}
          testAction={testAction}
          labelAction={labelAction}
          tested={tested[k.name]}
          onTested={onTested}
        />
      ))}
    </ul>
  );
  // A key's own Test: that key on a host typed on its row (`<key>@<host>`). Its answer, while
  // this is open — kept nowhere else, so it never outlives what it saw.
  const testAction = tool.actions.find((a) => a.ask === "key-host");
  // A key's Label: what it is for, written on it (`<key>@<what>`).
  const labelAction = tool.actions.find((a) => a.ask === "key-label");
  const [tested, setTested] = useState<Record<string, Tested>>({});
  const onTested = (name: string, host: string, ok: boolean) => setTested((t) => ({ ...t, [name]: { host, ok } }));
  // Each runs in the machine's terminal, over this dialog, which stays: closing the terminal
  // comes back here, and the list follows what it did (the overview is read again then).
  const run = ctx.onRun;
  const [adding, setAdding] = useState(false);
  const canAdd = tool.actions.some((a) => a.ask === "key-comment");

  return (
    <Overlay
      onClose={onClose}
      label="SSH keys"
      className="flex max-h-full w-full max-w-3xl flex-col rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:max-h-[85vh]"
    >
      <h2 className="text-base font-semibold text-slate-100">SSH keys for git</h2>
      <p className="mt-1 text-sm text-slate-400">The keys git uses here, and where.</p>
      {ctx.facts.ssh_match_exec && (
        <p className="mt-1 text-xs text-amber-300/90">
          This machine's ssh config may run a command to choose keys (Match exec, or a file it includes that Loskai can't follow), so Loskai doesn't ask ssh which key each remote uses: it only reads.
        </p>
      )}
      {missing.length > 0 && (
        <p className="mt-1 text-xs text-amber-300/90">
          ~/.ssh/config names {missing.length === 1 ? "a key" : "keys"} Loskai can't find here:{" "}
          <span className="font-mono">{missing.join(", ")}</span> (no .pub in ~/.ssh). A host{" "}
          {missing.length === 1 ? "it's" : "they're"} for may refuse every key.
        </p>
      )}
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
              // Nothing unclaimed: no section saying so.
              if (g.id === "other" && inIt.length === 0) return null;
              return (
                <section key={g.id} aria-label={g.title}>
                  <h3 className="text-xs font-medium text-slate-200">
                    {g.title} <span className="font-normal text-slate-500">— {g.hint}</span>
                  </h3>
                  {inIt.length === 0 ? <p className="mt-1 text-xs text-slate-500">None.</p> : list(inIt)}
                </section>
              );
            })}
          </div>
        )}
      </div>
      {canAdd && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500"
          >
            <KeyRound className="h-4 w-4" /> Add SSH key
          </button>
        </div>
      )}
      {adding && <AddToSite tool={tool} ctx={ctx} onClose={() => setAdding(false)} />}
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
// — Copy, Test, Label, Delete — so they line up down the list.
function KeyRow({
  info,
  uses,
  inSshConfig,
  facts,
  actions,
  tool,
  onRun,
  testAction,
  labelAction,
  tested,
  onTested,
}: {
  info: MachineKey;
  uses: KeyUse[] | null;
  inSshConfig: boolean;
  facts: Facts;
  actions: ToolAction[];
  tool: Tool;
  onRun: ToolStart;
  testAction?: ToolAction;
  labelAction?: ToolAction;
  tested?: Tested;
  onTested: (name: string, host: string, ok: boolean) => void;
}) {
  const { group, tag } = keyGroup(info, uses);
  // Its comment, without Loskai's mark: what Add SSH key names it, and the site lists.
  const title = commentText(info.comment);
  const [labelling, setLabelling] = useState(false);
  // Where to add it, until a Test has seen it get in.
  const sites = useSsh().data?.git_sites;
  const page = info.public && !tested?.ok ? keyPage(info, uses, sites) : null;
  return (
    <li className="flex gap-3 px-3 py-2 text-xs max-sm:flex-col">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* The name the site lists it by, when it has one; its file beside it. */}
          {title && <span className="min-w-0 break-words text-sm text-slate-100">{title}</span>}
          <span className={title ? "font-mono text-[11px] text-slate-500" : "font-mono text-sm text-slate-100"}>{info.name}</span>
          {tag && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">{tag}</span>}
          {inSshConfig && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
              <Hint text="~/.ssh/config names it — Delete leaves it alone">~/.ssh/config</Hint>
            </span>
          )}
        </div>
        <UsedBy uses={uses} inSshConfig={inSshConfig} account={group === "account"} isSshDefault={keyKind(info.name) === "account"} facts={facts} />
        {/* Its fingerprint is the one GitHub and Forgejo list beside a key; then where to
            paste it. */}
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-slate-500">
          <span className="min-w-0 truncate">
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
        {testAction && (
          <KeyTest
            tool={tool}
            action={testAction}
            name={info.name}
            start={keyHost(info, uses) ?? ""}
            tested={tested}
            onRun={onRun}
            onTested={onTested}
          />
        )}
        {labelAction && (
          <button
            type="button"
            aria-label={`Label ${info.name}`}
            aria-haspopup="dialog"
            title={keyLabel(info.comment) ? "Change what it is for — written on the key" : "Say what it is for — written on the key; the key stays the same"}
            onClick={() => setLabelling(true)}
            className="flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800"
          >
            <Tag className="h-2.5 w-2.5" /> Label
          </button>
        )}
        {actions.map((a) => (
          <KeyButton key={a.id} tool={tool} action={a} name={info.name} onRun={onRun} disabledReason={whyDisabled(a, inSshConfig)} />
        ))}
      </div>
      {labelling && labelAction && (
        <LabelKey tool={tool} action={labelAction} info={info} facts={facts} onRun={onRun} onClose={() => setLabelling(false)} />
      )}
    </li>
  );
}

// What a key does, in a line a remote: fetches or pushes which repository (› submodule), on
// which platform, through which ~/.ssh/config alias. Unused, a word on why.
function UsedBy({
  uses,
  inSshConfig,
  account,
  isSshDefault: own,
  facts,
}: {
  uses: KeyUse[] | null;
  inSshConfig: boolean;
  account: boolean;
  // ssh's own (`id_…`): offered wherever no other key is named — logins to other computers too.
  isSshDefault: boolean;
  facts: Facts;
}) {
  if (!uses && facts.ssh_match_exec)
    return (
      <p className="mt-0.5 w-fit text-slate-500">
        <Hint text="This machine's ssh config may run a command to choose keys (Match exec, or a file it includes that Loskai can't follow), so Loskai doesn't ask ssh: it only reads.">
          Loskai didn't ask which remotes use it
        </Hint>
      </p>
    );
  if (!uses) return <p className="mt-0.5 text-slate-500">Install the status line again to see where it's used.</p>;
  if (uses.length === 0) {
    // Only git's use of it is seen: it may be on an account, or log in elsewhere — so the
    // line says which remotes don't use it, and why, not that it is useless.
    const hasSshRemotes = (facts.remotes ?? []).some((r) => remoteSshHost(r.url));
    const why = inSshConfig
      ? "~/.ssh/config names it for a host no project here uses."
      : !account && !own
        ? "No remote here names it."
        : hasSshRemotes
          ? "The remotes here over SSH each use a key of their own; the rest are over HTTP(S), which needs none."
          : "The remotes here are over HTTP(S), which needs no key.";
    return (
      <p className="mt-0.5 w-fit text-slate-500">
        <Hint text={`${why} It may still be on your account, or log in elsewhere: Loskai sees only git here.`}>
          No git remote here uses it
        </Hint>
        {own && (
          <span className="text-amber-300/80">
            {" · "}
            <Hint text="ssh offers it to any computer this machine logs in to without naming a key — deleting it can lock those logins out">
              ssh's default
            </Hint>
            {" — it may log in to other computers"}
          </span>
        )}
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
            <span className="text-amber-300/80">
              {" · "}
              <Hint text={`One of several keys ssh offers there — each one's Test with ${u.host} says which gets in`}>offered</Hint>
            </span>
          )}
        </p>
      ))}
    </div>
  );
}

// Why a key's button is greyed, or null: Delete of a key ~/.ssh/config names — that file is
// yours.
function whyDisabled(action: ToolAction, inSshConfig: boolean): string | null {
  if (action.id === "delete-key" && inSshConfig) return "~/.ssh/config names this key — take it out there first; Loskai doesn't edit that file";
  return null;
}

// A key's button — rose for one that asks first (Delete); greyed, saying why, when `disabledReason` is given.
function KeyButton({
  tool,
  action,
  name,
  onRun,
  disabledReason = null,
}: {
  tool: Tool;
  action: ToolAction;
  name: string;
  onRun: ToolStart;
  disabledReason?: string | null;
}) {
  return (
    <ReasonButton
      aria-label={`${action.label} ${name}`}
      title={action.description}
      reason={disabledReason}
      onClick={() => onRun({ tool: tool.id, action: action.id, target: name, title: `${action.label}: ${name}` }, action)}
      className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] hover:bg-slate-800 aria-disabled:opacity-40 aria-disabled:hover:bg-transparent ${
        action.confirm ? "border-rose-500/40 text-rose-300" : "border-slate-700 text-slate-200"
      }`}
    >
      <ActionIcon tool={tool.id} action={action.id} /> {action.label}
    </ReasonButton>
  );
}

// Copy: the key's public line on the clipboard, ready to paste where it goes — read from the
// overview, so nothing runs on the machine. Its comment goes with it: Forgejo names a key by
// it.
function CopyKey({ info, page }: { info: MachineKey; page: { where: string } | null }) {
  if (!info.public) {
    return (
      <Hint text="The status line is older: install it again to copy keys from here" className="px-1.5 py-0.5 text-[11px] text-slate-600">
        Copy —
      </Hint>
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
  tested,
  onRun,
  onTested,
}: {
  tool: Tool;
  action: ToolAction;
  name: string;
  start: string;
  tested?: Tested;
  onRun: ToolStart;
  onTested: (name: string, host: string, ok: boolean) => void;
}) {
  const [host, setHost] = useState(start);
  // Once it got in, the field is done with: the answer in its place, until clicked to test again.
  const [retesting, setRetesting] = useState(false);
  const refused = tested && !tested.ok;
  const { remember } = useRecentHosts();
  const trimmedHost = host.trim();
  const runTest = () => {
    if (!trimmedHost) return;
    setRetesting(false);
    remember(trimmedHost);
    onRun({ tool: tool.id, action: action.id, target: `${name}@${trimmedHost}`, title: `Test: ${name} on ${trimmedHost}` }, action, (ok) => onTested(name, trimmedHost, ok));
  };
  if (tested?.ok && !retesting) {
    return (
      <button
        type="button"
        aria-label={`Tested ${name}: it gets in on ${tested.host} — test again`}
        title={`It got in on ${tested.host} just now — click to test it again, or on another host`}
        onClick={() => setRetesting(true)}
        className="flex w-[9.75rem] items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/20"
      >
        <Check className="h-3 w-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left font-mono">{tested.host}</span>
        {/* Clicked, it tests again: said by the arrow at its end. */}
        <RotateCw aria-hidden className="h-3 w-3 shrink-0 opacity-70" />
      </button>
    );
  }
  return (
    // Refused: the field and Test stay — another host, or adding the key, comes next — and a
    // word after them says so, its host in the hint (a phone can't read a title). Short of
    // room, the word goes under them, never pushing the row wider.
    <span className="flex flex-wrap items-center justify-end gap-y-1">
      <HostInput
        label={`Host to test ${name} on`}
        value={host}
        onChange={setHost}
        onEnter={runTest}
        placeholder="host"
        className={`w-28 min-w-0 rounded-l-md border border-r-0 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 ${
          refused ? "border-rose-500/60" : "border-slate-700"
        }`}
      />
      <button
        type="button"
        aria-label={`Test ${name}`}
        disabled={!trimmedHost}
        title={trimmedHost ? `Try ${name} alone on ${trimmedHost}` : "Type the host it is for — github.com, your Forgejo's"}
        onClick={runTest}
        className="flex items-center gap-1 rounded-r-md border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-40"
      >
        <ActionIcon tool={tool.id} action={action.id} /> {action.label}
      </button>
      {refused && (
        <span className="ml-1.5 text-[11px] text-rose-300">
          <Hint text={`${tested.host} refused it just now`}>refused</Hint>
        </span>
      )}
    </span>
  );
}

// A key's host field, and the list it opens once clicked into: the hosts keys were tested on
// before, newest first — in this browser, ✕ forgetting one — then the git sites, by name
// and SSH address, then Add a site…, which keeps a new one in Loskai and fills it in. All of
// them while the field holds what was there; what matches, once typed in. The list is placed
// from the field, fixed, so a scrolling list of keys can't cut it off.
function HostInput({
  label,
  value,
  onChange,
  onEnter,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (host: string) => void;
  onEnter: () => void;
  placeholder: string;
  className: string;
}) {
  const { hosts, forget, refresh } = useRecentHosts();
  const sites = useSsh().data?.git_sites ?? [];
  const field = useRef<HTMLInputElement>(null);
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const [typing, setTyping] = useState(false);
  const [adding, setAdding] = useState(false);
  const typed = value.trim().toLowerCase();
  const matches = (...texts: string[]) => !typing || texts.some((t) => t.toLowerCase().includes(typed));
  const siteOf = (h: string) => sites.find((s) => s.ssh === h);
  const recent = hosts.filter((h) => matches(h, siteOf(h)?.name ?? ""));
  const others = sites.filter((s) => !hosts.includes(s.ssh) && matches(s.ssh, s.name));
  const open = () => {
    refresh();
    setTyping(false);
    const r = field.current?.getBoundingClientRect();
    // At least 200px wide, and kept inside the window: the field is at a row's right end.
    if (r) {
      const width = Math.max(r.width, 200);
      setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width });
    }
  };
  const pick = (h: string) => {
    onChange(h);
    setAt(null);
  };
  const ITEM = "flex min-w-0 flex-1 items-baseline gap-2 px-2 py-1 text-left text-[11px]";
  // mousedown kept from the field, so it stays open and focused
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const shown = (h: string, name?: string) => (
    <>
      {name && <span className="text-slate-200">{name}</span>}
      <span className={`truncate font-mono ${name ? "text-slate-500" : "text-slate-200"}`}>{h}</span>
    </>
  );
  return (
    <>
      <input
        ref={field}
        aria-label={label}
        value={value}
        onChange={(e) => {
          setTyping(true);
          onChange(e.target.value);
        }}
        onFocus={open}
        onBlur={() => setAt(null)}
        onKeyDown={(e) => {
          // Escape closes the list, not the dialog under it.
          if (e.key === "Escape" && at) {
            e.preventDefault();
            setAt(null);
          } else if (e.key === "Enter") {
            setAt(null);
            onEnter();
          }
        }}
        placeholder={placeholder}
        className={className}
      />
      {at && (
        <ul
          aria-label="Hosts"
          style={{ top: at.top, left: at.left, minWidth: at.width }}
          className="fixed z-[55] max-h-56 overflow-auto rounded-md border border-slate-700 bg-slate-900 py-1 shadow-xl"
        >
          {recent.map((h) => (
            <li key={h} className="flex items-center hover:bg-slate-800">
              <button type="button" onMouseDown={keep} onClick={() => pick(h)} className={ITEM}>
                {shown(h, siteOf(h)?.name)}
              </button>
              <button
                type="button"
                aria-label={`Forget ${h}`}
                title="Forget it — wrong, or no longer used"
                onMouseDown={keep}
                onClick={() => forget(h)}
                className="px-1.5 py-1 text-slate-500 hover:text-rose-300"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
          {others.map((s) => (
            <li key={s.name} className="flex items-center hover:bg-slate-800">
              <button type="button" onMouseDown={keep} onClick={() => pick(s.ssh)} className={ITEM}>
                {shown(s.ssh, s.name)}
              </button>
            </li>
          ))}
          <li className="mt-1 flex items-center border-t border-slate-800 pt-1 hover:bg-slate-800">
            <button
              type="button"
              onMouseDown={keep}
              onClick={() => {
                setAt(null);
                setAdding(true);
              }}
              className={`${ITEM} text-teal-300`}
            >
              Add a site…
            </button>
          </li>
        </ul>
      )}
      {adding && (
        <AddSite
          sites={sites}
          onClose={() => setAdding(false)}
          onAdded={(s) => {
            setAdding(false);
            onChange(s.ssh);
          }}
        />
      )}
    </>
  );
}

// Label: what a key is for, picked here and written on the key — its comment's
// `(loskai: …)`, what was before it kept. An account key, for a platform or not; a deploy key,
// for a project; a login key, for other computers. The key and its fingerprint stay the same.
function LabelKey({
  tool,
  action,
  info,
  facts,
  onRun,
  onClose,
}: {
  tool: Tool;
  action: ToolAction;
  info: MachineKey;
  facts: Facts;
  onRun: ToolStart;
  onClose: () => void;
}) {
  const now = keyLabel(info.comment);
  const [kind, setKind] = useState<"account" | "deploy" | "login">(now?.kind === "for" ? "account" : (now?.kind ?? "account"));
  const [host, setHost] = useState(now?.kind === "for" ? now.host : "");
  const [project, setProject] = useState(now?.kind === "deploy" ? now.project : "");
  const projects = [...new Set((facts.projects ?? []).map((p) => p.name))].sort();
  const what =
    kind === "login" ? "login" : kind === "deploy" ? (project.trim() ? `deploy:${project.trim()}` : null) : host.trim() ? `for:${host.trim()}` : "account";
  const FIELD = "w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-sm text-slate-100 outline-none focus:border-teal-500";
  return (
    <Overlay onClose={onClose} label={`Label ${info.name}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!what) return;
          onClose();
          onRun({ tool: tool.id, action: action.id, target: `${info.name}@${what}`, title: `Label: ${info.name}` }, action);
        }}
      >
        <h2 className="text-base font-semibold text-slate-100">
          Label <span className="font-mono">{info.name}</span>
        </h2>
        <p className="mt-1 text-sm text-slate-400">What it is for — written on the key. It goes on working as it is.</p>
        <fieldset className="mt-4 space-y-3">
          <legend className="sr-only">What it is for</legend>
          <label className="flex items-start gap-2 text-sm text-slate-200">
            <input type="radio" name="kind" checked={kind === "account"} onChange={() => setKind("account")} className="mt-1 accent-teal-500" />
            <span className="flex-1">
              Account key
              <span className="block text-xs text-slate-500">On your account on a platform — every repository you can reach.</span>
              {kind === "account" && (
                <input aria-label="Platform" value={host} onChange={(e) => setHost(e.target.value)} placeholder="github.com — or empty" className={`mt-1.5 ${FIELD}`} />
              )}
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-200">
            <input type="radio" name="kind" checked={kind === "deploy"} onChange={() => setKind("deploy")} className="mt-1 accent-teal-500" />
            <span className="flex-1">
              Deploy key
              <span className="block text-xs text-slate-500">On one repository, for one project.</span>
              {kind === "deploy" && (
                <>
                  <input aria-label="Project" list={`projects-${info.name}`} value={project} onChange={(e) => setProject(e.target.value)} placeholder="its project" className={`mt-1.5 ${FIELD}`} />
                  <datalist id={`projects-${info.name}`}>
                    {projects.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </>
              )}
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-200">
            <input type="radio" name="kind" checked={kind === "login"} onChange={() => setKind("login")} className="mt-1 accent-teal-500" />
            <span>
              Login key
              <span className="block text-xs text-slate-500">For logging in to other computers — not git's, so Keys stops listing it.</span>
            </span>
          </label>
        </fieldset>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button type="submit" disabled={!what} className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50">
            Label
          </button>
        </div>
      </form>
    </Overlay>
  );
}
