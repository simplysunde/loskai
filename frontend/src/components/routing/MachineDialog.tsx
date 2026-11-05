import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Boxes,
  HardDrive,
  KeyRound,
  Loader2,
  ScrollText,
  Search,
  SlidersHorizontal,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { api, apiMessage } from "../../lib/api";
import { useRoutes } from "../../lib/routes";
import { useSettings } from "../../lib/settings";
import { useFacts, useRunning, useSsh } from "../../lib/ssh";
import type { ToolContext } from "../../lib/toolRows";
import { applies, useTools, type ToolTarget } from "../../lib/tools";
import { assembleFqdn, isValidDnsOnlyPrefix, isValidDnsTarget, SSH_USER } from "../../lib/validation";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { Modal, Overlay } from "../shared/Modal";
import { InlineText, SettingRow, Switch } from "../shared/SettingRow";
import { SshLog } from "../settings/SshLog";
import type { NewMachine } from "./AddMachineModal";
import { isMachine } from "./machine";
import { MachineOverview } from "./MachineOverview";
import { AddToolMenu, MachineTools, RowButtons } from "./MachineTools";
import { RunningList } from "./RunningPill";
import { SaveBanner } from "./SaveBanner";
import { SshSetupModal } from "./SshSetupModal";
import { useSaveMachine, type SaveResult } from "./useSaveMachine";
import { useToolRunner } from "./useToolRunner";
import { INPUT } from "../../lib/ui";

// What opening a machine can hand over: what a save said, and whether to start its SSH
// setup — after naming it, or from a tool's "Install again".
export interface MachineState {
  result?: SaveResult;
  setup?: boolean;
}

// The dialog's sections, one after another in a single scroll, and in the side menu in
// groups split by a line. `words` is what the search finds a section by besides its name —
// the settings and things in it. All but the first two need the machine's SSH user.
type SectionId = "general" | "ssh" | "tools" | "running" | "log";
const SECTIONS: { id: SectionId; label: string; icon: ComponentType<{ className?: string }>; group: number; words: string }[] = [
  {
    id: "general", label: "General", icon: SlidersHorizontal, group: 0,
    words: "name hostname address ip moved routes overview system os kernel uptime memory disks updates tailscale",
  },
  { id: "ssh", label: "SSH", icon: KeyRound, group: 0, words: "user login port host key set up setup test turn on off remove config sudo password updates" },
  { id: "tools", label: "Tools", icon: Wrench, group: 1, words: "add install projects folder git name email" },
  { id: "running", label: "Running", icon: Boxes, group: 1, words: "containers services guests lxc vm restart stop" },
  { id: "log", label: "Log", icon: ScrollText, group: 2, words: "terminals sessions opened closed refused installs" },
];

const BUTTON =
  "flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs hover:bg-slate-800";

// One machine, from the cog on its row — at /machines/<id>/<category>, over the Machines tab.
// What belongs to this machine alone: its name, address and SSH login (each saved as it is
// edited), its SSH setup, its overview, its tools, what runs on it, and its log. What is the
// same for every machine is in Settings › SSH.
export function MachineDialog({ id, section }: { id: string; section?: string }) {
  const navigate = useNavigate();
  const handed = (useLocation().state ?? {}) as MachineState;
  const [result, setResult] = useState<SaveResult | null>(handed.result ?? null);
  const [setup, setSetup] = useState(Boolean(handed.setup));
  const [removing, setRemoving] = useState(false);
  const [enabling, setEnabling] = useState(false);
  // Your password, when removing the connection needs Loskai's key unlocked.
  const [removePassword, setRemovePassword] = useState("");
  const [query, setQuery] = useState("");
  // The section the side menu marks: the one scrolled to, or the one just picked.
  const [active, setActive] = useState<string>(() =>
    SECTIONS.some((s) => s.id === section) ? section! : "general",
  );
  const pane = useRef<HTMLDivElement>(null);
  const anchors = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  // While a pick scrolls the pane, the scroll doesn't move the mark.
  const picking = useRef(0);
  const opened = useRef(false);

  const routes = useRoutes();
  const settings = useSettings();
  const tools = useTools();
  const ssh = useSsh();
  const trusted = Boolean(ssh.data?.trusted[id]);
  const running = useRunning(trusted);
  const facts = useFacts(id, trusted);

  const save = useSaveMachine({
    onSaved: (data, m) => {
      setResult(data);
      // A login just given starts its setup, as naming a machine does.
      if (m.ssh && !trusted) setSetup(true);
    },
    // Each row shows its own error.
    onError: () => {},
  });

  // Removing the SSH connection takes Loskai's key and sudo rule off the machine first, which
  // needs the key unlocked: your password, typed in the dialog when it is locked.
  const keyUnlocked = Boolean(
    ssh.data?.key?.unlocked_until && Date.parse(ssh.data.key.unlocked_until) > Date.now(),
  );
  const removeNeedsPassword = trusted && Boolean(ssh.data?.key) && !keyUnlocked;
  const removeSsh = useMutation({
    mutationFn: async (change: NewMachine) => {
      if (removeNeedsPassword) await api.post("/api/ssh/unlock", { password: removePassword });
      return save.mutateAsync(change);
    },
    onSuccess: () => {
      setRemoving(false);
      setRemovePassword("");
    },
  });

  const machine = routes.data?.find((r) => r.id === id && isMachine(r));
  const runner = useToolRunner(machine && { id: machine.id, name: machine.name }, ssh.data?.key ?? null);
  const close = () => navigate("/machines");

  // Opened at a section (/machines/<id>/ssh): start there, once the sections are drawn.
  const ready = Boolean(machine && ssh.data);
  useEffect(() => {
    if (!ready || opened.current) return;
    opened.current = true;
    const at = anchors.current[section as SectionId];
    if (at && at !== anchors.current.general) pick(section as SectionId, "auto");
  });

  function pick(s: SectionId, behavior: ScrollBehavior = "smooth") {
    setActive(s);
    picking.current = Date.now() + 800;
    anchors.current[s]?.scrollIntoView?.({ behavior, block: "start" });
  }

  // The mark follows the scroll: the last section whose top has passed the pane's top, or
  // the last one once the pane is scrolled to its end.
  function onScroll() {
    const el = pane.current;
    if (!el || Date.now() < picking.current) return;
    const ids = (Object.keys(anchors.current) as SectionId[]).filter((k) => anchors.current[k]);
    const top = el.getBoundingClientRect().top + 24;
    let at = ids[0];
    for (const k of ids) if (anchors.current[k]!.getBoundingClientRect().top <= top) at = k;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) at = ids[ids.length - 1];
    if (at) setActive(at);
  }

  if (!machine) {
    return (
      <Shell label="Machine" title="Machine" onClose={close}>
        <div className="p-6">
          {routes.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          ) : (
            <p className="text-sm text-slate-500">No such machine.</p>
          )}
        </div>
      </Shell>
    );
  }

  const host = machine.subdomain ? ssh.data?.hosts[machine.subdomain] : undefined;
  const hostname = machine.subdomain ?? machine.id;
  const baseDomain = settings.data?.base_domain?.value ?? null;
  const programs = facts.data?.programs ?? [];
  const here = (tools.data ?? []).filter((t) => applies(t, programs));
  // What a tool's card needs — once the overview and the tools are in.
  const ctx: ToolContext | null =
    facts.data?.ok && tools.data && ssh.data
      ? { machineId: id, tools: tools.data, facts: facts.data, folder: ssh.data.projects[id], onRun: runner.start }
      : null;
  const rowActions = (target: ToolTarget, name: string) => (
    <RowButtons here={here} kind={target} name={name} onRun={runner.start} />
  );
  const runningHere = running.data?.[id];

  // Every save is the whole machine, with this one change: SSH only when it is the change.
  const post = (change: Partial<NewMachine>) =>
    save.mutateAsync({
      hostname,
      address: machine.upstream ?? "",
      instance_id: machine.id,
      ...change,
    });

  const available = SECTIONS.filter((s) => s.group === 0 || host?.user);
  // Searching narrows the menu and the sections shown to those it finds.
  const q = query.trim().toLowerCase();
  const toolNames = (tools.data ?? []).map((t) => t.name).join(" ");
  const shown = available.filter(
    (s) => !q || `${s.label} ${s.words} ${s.id === "tools" ? toolNames : ""}`.toLowerCase().includes(q),
  );

  const content: Record<SectionId, ReactNode> = {
    general: (
      <>
      <div>
        <SettingRow
          label="Machine name"
          description={
            <>
              What DNS answers for — dots allowed →{" "}
              <span className="text-teal-300">{baseDomain ? assembleFqdn(hostname, baseDomain) : hostname}</span>
            </>
          }
        >
          <InlineText
            label="Machine name"
            value={hostname}
            validate={(v) =>
              isValidDnsOnlyPrefix(v.toLowerCase()) ? null : "Each dot-separated label: lowercase letters, digits, hyphens."
            }
            onSave={(v) => post({ hostname: v.toLowerCase() })}
          />
        </SettingRow>
        <SettingRow label="Address" description="Its LAN IP. Moving it moves the routes on it.">
          <InlineText
            label="Address"
            value={machine.upstream ?? ""}
            mono
            validate={(v) => (isValidDnsTarget(v) ? null : "A bare IPv4 address — no port.")}
            onSave={(v) => post({ address: v })}
          />
        </SettingRow>
      </div>
      {/* What the machine says about itself, read with the status key. */}
      {host?.user && (
        <div className="mt-3">
          {!trusted ? (
            <NotYet onSetUp={() => setSetup(true)}>Set up SSH to see its system, memory and disks.</NotYet>
          ) : (
            <MachineOverview facts={facts.data} onReinstall={() => setSetup(true)} />
          )}
        </div>
      )}
      </>
    ),
    ssh: (
      <div>
        {!host && (
          <p className="py-2 text-xs text-slate-500">
            Off — Loskai doesn't log in to this machine. Turn it on to manage it over SSH.
          </p>
        )}
        {host && (
          <SettingRow
            label="Login"
            description={
              !host.user
                ? "Your SSH config gives the user — set one here for Loskai to manage the machine."
                : "The user Loskai logs in as, and the port its SSH server listens on."
            }
          >
            <InlineText
              label="SSH user"
              width="w-40"
              value={host.user ?? ""}
              placeholder="from SSH config"
              validate={(v) =>
                !v
                  ? "Turn SSH off above instead."
                  : SSH_USER.test(v)
                    ? null
                    : "A login name: letters, digits, _ . - (not starting with a digit)."
              }
              onSave={(v) => post({ ssh: { user: v, port: host.port ?? 22 } })}
            />
            <InlineText
              label="SSH port"
              width="w-14"
              value={String(host.port ?? 22)}
              disabled={!host.user}
              validate={(v) => (/^\d+$/.test(v) && +v >= 1 && +v <= 65535 ? null : "A port from 1 to 65535.")}
              onSave={(v) => post({ ssh: { user: host.user!, port: Number(v) } })}
            />
          </SettingRow>
        )}
        {host?.user && (
          <SettingRow label="Setup" description="Its host key, Loskai's key on it, and a test.">
            {trusted ? (
              <span className="text-xs text-emerald-300">set up</span>
            ) : (
              <span className="text-xs text-amber-300">not set up</span>
            )}
            <button onClick={() => setSetup(true)} className={`${BUTTON} text-slate-200`}>
              {trusted ? "SSH setup" : "Set up SSH"}
            </button>
          </SettingRow>
        )}
        {host?.user && trusted && (
          <SettingRow
            label="Updates without a password"
            description="System's Update runs without asking: a sudo rule on the machine for exactly its update commands."
          >
            {host.user === "root" ? (
              <span className="text-xs text-slate-500">not needed — it logs in as root</span>
            ) : facts.data?.ok ? (
              <>
                {facts.data.sudo_rule !== "on" && facts.data.sudo_rule !== "off" && (
                  <span title="The machine doesn't let its user look in /etc/sudoers.d" className="cursor-help text-xs text-slate-500">
                    can't tell
                  </span>
                )}
                {/* Either way an automatic run in the machine's terminal; the switch moves
                    when the overview reads the rule back. */}
                <Switch
                  label="Updates without a password"
                  title="On asks for sudo's password once, for that run only; off needs none"
                  checked={facts.data.sudo_rule === "on"}
                  onChange={() =>
                    facts.data?.ok && facts.data.sudo_rule === "on"
                      ? runner.start({ sudo: "remove", title: "Take off updates without a password" })
                      : runner.start({ sudo: "allow", title: "Allow updates without a password" })
                  }
                />
              </>
            ) : (
              <span className="text-xs text-slate-500">needs its overview — see General</span>
            )}
          </SettingRow>
        )}
      </div>
    ),
    tools: ctx ? (
      <MachineTools ctx={ctx} />
    ) : !trusted ? (
      <NotYet onSetUp={() => setSetup(true)}>Set up SSH to use its tools.</NotYet>
    ) : facts.data && !facts.data.ok ? (
      // General says why, with the button to fix it.
      <p className="text-xs text-slate-500">They need its overview, which can't be read — see General.</p>
    ) : (
      <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
    ),
    running: (
      <div className="overflow-x-auto rounded-xl border border-slate-800 text-xs text-slate-300">
        {!trusted ? (
          <div className="p-3">
            <NotYet onSetUp={() => setSetup(true)}>Set up SSH to see what runs here.</NotYet>
          </div>
        ) : !runningHere ? (
          <Loader2 className="m-3 h-4 w-4 animate-spin text-slate-500" />
        ) : runningHere.ok ? (
          <RunningList running={runningHere} user={host?.user} actions={rowActions} />
        ) : (
          <p className="p-3 text-amber-300">Unreachable: {runningHere.error}</p>
        )}
      </div>
    ),
    log: <SshLog machine={id} />,
  };
  // What a section's heading has on its right.
  const headingActions: Partial<Record<SectionId, ReactNode>> = {
    tools: ctx && <AddToolMenu ctx={ctx} />,
    // On is an entry in the SSH config. Either way a dialog says what happens first.
    ssh: (
      <Switch
        label="SSH"
        checked={Boolean(host)}
        onChange={() => (host ? setRemoving(true) : setEnabling(true))}
      />
    ),
  };

  return (
    <>
      <Shell
        label={machine.name}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <HardDrive className="h-4 w-4 shrink-0 text-teal-300/70" />
            <span className="truncate">{machine.name}</span>
            <span className="truncate font-mono text-xs font-normal text-slate-500">
              {machine.fqdn ?? "—"} · {machine.upstream ?? "—"}
            </span>
          </span>
        }
        action={
          trusted && host?.user ? (
            <button onClick={runner.openShell} className={`${BUTTON} text-slate-200`}>
              <Terminal className="h-3.5 w-3.5" /> Terminal
            </button>
          ) : null
        }
        onClose={close}
      >
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* A strip across the top on a phone, a column with the search beside the content wider up. */}
          <nav
            aria-label="Categories"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-800 p-2 sm:block sm:w-52 sm:space-y-0.5 sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3"
          >
            <label className="mb-2 hidden items-center sm:flex gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-slate-500" />
              <input
                aria-label="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600"
              />
            </label>
            {shown.map((s, i) => (
              <div key={s.id} className="shrink-0">
                {i > 0 && shown[i - 1].group !== s.group && (
                  <div className="mx-2 my-2 hidden border-t border-slate-800 sm:block" />
                )}
                <button
                  onClick={() => pick(s.id)}
                  aria-current={s.id === active ? "location" : undefined}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition sm:gap-3 ${
                    s.id === active
                      ? "bg-teal-500/10 text-teal-200"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`}
                >
                  <s.icon className="h-4 w-4" />
                  {s.label}
                </button>
              </div>
            ))}
            {shown.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">Nothing matches.</p>}
          </nav>
          <div ref={pane} onScroll={onScroll} className="min-w-0 flex-1 overflow-auto px-5 pb-5">
            {result && <div className="pt-4"><SaveBanner result={result} /></div>}
            {shown.map((s) => (
              <section
                key={s.id}
                aria-label={s.label}
                ref={(el) => {
                  anchors.current[s.id] = el;
                }}
                className="border-b border-slate-800 py-4 last-of-type:border-b-0"
              >
                <div className="mb-2 flex items-center justify-between gap-4">
                  <h2 className="text-sm font-semibold text-slate-100">{s.label}</h2>
                  {headingActions[s.id]}
                </div>
                {content[s.id]}
              </section>
            ))}
            {/* Room for the last section to scroll to the top when picked. */}
            <div className="h-[40vh]" aria-hidden="true" />
          </div>
        </div>
      </Shell>

      <ConfirmDialog
        open={removing}
        title={`Turn off SSH for ${machine.name}?`}
        confirmLabel="Turn off"
        destructive
        onConfirm={() =>
          removeSsh.mutate({
            hostname, address: machine.upstream ?? "", instance_id: machine.id, ssh: null,
          })
        }
        onCancel={() => {
          setRemoving(false);
          removeSsh.reset();
        }}
      >
        {trusted
          ? "Loskai's key and its sudo rule come off the machine — nothing else there changes — then its entry, user and port go, and its host key is forgotten."
          : "Its entry goes, and with it the user and port."}
        {removeNeedsPassword && (
          <input
            type="password"
            autoComplete="current-password"
            aria-label="Your password"
            placeholder="Your password — unlocks Loskai's key"
            value={removePassword}
            onChange={(e) => setRemovePassword(e.target.value)}
            className={`mt-3 block ${INPUT}`}
          />
        )}
        {removeSsh.isError && (
          <span className="mt-2 block text-rose-400">
            {apiMessage(removeSsh.error, "Couldn't turn it off")}
          </span>
        )}
      </ConfirmDialog>

      {enabling && (
        <EnableSsh
          name={machine.name}
          onClose={() => setEnabling(false)}
          onSave={async (login) => {
            await post({ ssh: login });
            setEnabling(false);
          }}
        />
      )}

      {/* Shown once the SSH config has the login: just after a save, on its refetch. */}
      {setup && host?.user && (
        <SshSetupModal
          machine={{ id: machine.id, name: machine.name }}
          host={host}
          sshKey={ssh.data?.key ?? null}
          onClose={() => setSetup(false)}
        />
      )}

      {runner.ui}
    </>
  );
}

function Shell({
  label,
  title,
  action,
  onClose,
  children,
}: {
  label: string;
  title: ReactNode;
  action?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Overlay
      onClose={onClose}
      label={label}
      className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
    >
      <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-5 py-3">
        <div className="min-w-0 text-sm font-semibold text-slate-100">{title}</div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {children}
    </Overlay>
  );
}

// Turning SSH on: the login, and what comes next. Saving puts it in the SSH config, and the
// setup — trust its host key, then Loskai's key onto it — opens straight after, as when a
// user is typed in.
function EnableSsh({
  name,
  onSave,
  onClose,
}: {
  name: string;
  onSave: (login: { user: string; port: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const save = useMutation({ mutationFn: () => onSave({ user, port: Number(port) }) });
  const ok = SSH_USER.test(user) && /^\d+$/.test(port) && +port >= 1 && +port <= 65535;
  return (
    <Modal title={`Turn on SSH for ${name}`} onClose={onClose} narrow>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-xs text-slate-500">
          Loskai logs in with its own key, as the user you give it — a <span className="font-mono">loskai</span>{" "}
          user with sudo is a good choice. Next you trust the machine's host key, then either type
          the machine's password once and Loskai puts its key there, or add the key yourself.
        </p>
        <div className="flex gap-2">
          <input aria-label="SSH user" placeholder="User" value={user} autoFocus
            onChange={(e) => setUser(e.target.value.trim())} className={`${FIELD} flex-1`} />
          <input aria-label="SSH port" inputMode="numeric" value={port}
            onChange={(e) => setPort(e.target.value.trim())} className={`${FIELD} w-20`} />
        </div>
        {user && !ok && (
          <p className="text-xs text-rose-400">A login name (letters, digits, _ . -) and a port from 1 to 65535.</p>
        )}
        {save.isError && (
          <p className="text-xs text-rose-400">{apiMessage(save.error, "Couldn't turn it on")}</p>
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={!ok || save.isPending}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Turn on
          </button>
        </div>
      </form>
    </Modal>
  );
}

const FIELD =
  "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500";

function NotYet({ onSetUp, children }: { onSetUp: () => void; children: ReactNode }) {
  return (
    <p className="text-xs text-slate-500">
      {children}{" "}
      <button onClick={onSetUp} className="text-teal-400 hover:underline">
        Set up SSH
      </button>
    </p>
  );
}
