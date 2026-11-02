import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

import { api, ApiError } from "../../lib/api";
import type { SettingsView } from "../../lib/settings";
import { useFacts, useRunning, useSsh } from "../../lib/ssh";
import type { ToolContext } from "../../lib/toolRows";
import { applies, useTools, type ToolTarget } from "../../lib/tools";
import { useScrollLock } from "../../lib/useScrollLock";
import { assembleFqdn, isValidDnsOnlyPrefix, isValidDnsTarget, SSH_USER } from "../../lib/validation";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { InlineText, SettingRow } from "../shared/SettingRow";
import { SshLog } from "../settings/SshLog";
import type { NewMachine } from "./AddMachineModal";
import { isMachine } from "./machine";
import { MachineOverview } from "./MachineOverview";
import { AddToolMenu, MachineTools, RowButtons } from "./MachineTools";
import { RunningList } from "./RunningPill";
import { SaveBanner } from "./SaveBanner";
import type { RouteRow } from "./ServiceTable";
import { SshSetupModal } from "./SshSetupModal";
import { useSaveMachine, type SaveResult } from "./useSaveMachine";
import { useToolRunner } from "./useToolRunner";

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
    words: "name hostname address ip moved routes projects folder overview system os kernel uptime memory disks updates tailscale",
  },
  { id: "ssh", label: "SSH", icon: KeyRound, group: 0, words: "user login port host key set up setup test remove config sudo password updates" },
  { id: "tools", label: "Tools", icon: Wrench, group: 1, words: "add install" },
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
  const qc = useQueryClient();
  const handed = (useLocation().state ?? {}) as MachineState;
  const [result, setResult] = useState<SaveResult | null>(handed.result ?? null);
  const [setup, setSetup] = useState(Boolean(handed.setup));
  const [removing, setRemoving] = useState(false);
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
  useScrollLock(true);

  const routes = useQuery({
    queryKey: ["caddy-routes"],
    queryFn: () => api.get<RouteRow[]>("/api/caddy/routes"),
    refetchInterval: 15_000,
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsView>("/api/settings"),
  });
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
      name: machine.name,
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
        <SettingRow label="Name" description="What Loskai calls it.">
          <InlineText
            label="Name"
            value={machine.name}
            validate={(v) => (v ? null : "It needs a name.")}
            onSave={(v) => post({ name: v })}
          />
        </SettingRow>
        <SettingRow
          label="Hostname"
          description={
            <>
              The name DNS answers for — dots allowed →{" "}
              <span className="text-teal-300">{baseDomain ? assembleFqdn(hostname, baseDomain) : hostname}</span>
            </>
          }
        >
          <InlineText
            label="Hostname"
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
        {host?.user && ssh.data && (
          <SettingRow label="Projects folder" description="Where Claude Code finds its projects: ~ or one folder in it.">
            <InlineText
              label="Projects folder"
              value={ssh.data.projects[id]}
              mono
              onSave={async (v) => {
                await api.put(`/api/ssh/machines/${id}/projects`, { folder: v });
                await qc.invalidateQueries({ queryKey: ["ssh"] });
              }}
            />
          </SettingRow>
        )}
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
        <SettingRow
          label="User"
          description={
            host && !host.user
              ? "Your SSH config gives it — set one here for Loskai to manage the machine."
              : "The user Loskai logs in as. Give it one to manage the machine over SSH."
          }
        >
          <InlineText
            label="SSH user"
            value={host?.user ?? ""}
            placeholder={host ? "from SSH config" : "none"}
            validate={(v) =>
              !v
                ? "Remove it from the SSH config below instead."
                : SSH_USER.test(v)
                  ? null
                  : "A login name: letters, digits, _ . - (not starting with a digit)."
            }
            onSave={(v) => post({ ssh: { user: v, port: host?.port ?? 22 } })}
          />
        </SettingRow>
        <SettingRow label="Port" description="Where its SSH server listens.">
          <InlineText
            label="SSH port"
            value={String(host?.port ?? 22)}
            disabled={!host?.user}
            validate={(v) => (/^\d+$/.test(v) && +v >= 1 && +v <= 65535 ? null : "A port from 1 to 65535.")}
            onSave={(v) => post({ ssh: { user: host!.user!, port: Number(v) } })}
          />
        </SettingRow>
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
            description="System's Update runs without asking: a sudo rule on the machine for exactly its update commands. You type your password once, in its terminal — Loskai never sees it."
          >
            {host.user === "root" ? (
              <span className="text-xs text-slate-500">not needed — it logs in as root</span>
            ) : facts.data?.ok ? (
              <>
                {facts.data.sudo_rule === "on" ? (
                  <span className="text-xs text-emerald-300">on</span>
                ) : facts.data.sudo_rule === "off" ? (
                  <span className="text-xs text-slate-500">off</span>
                ) : (
                  <span title="The machine doesn't let its user look in /etc/sudoers.d" className="cursor-help text-xs text-slate-500">
                    can't tell
                  </span>
                )}
                {facts.data.sudo_rule !== "on" && (
                  <button
                    onClick={() => runner.start({ sudo: "allow", title: "Allow updates without a password" })}
                    className={`${BUTTON} text-slate-200`}
                  >
                    Allow
                  </button>
                )}
                {facts.data.sudo_rule !== "off" && (
                  <button
                    onClick={() => runner.start({ sudo: "remove", title: "Take off updates without a password" })}
                    className={`${BUTTON} text-slate-200`}
                  >
                    Take it off
                  </button>
                )}
              </>
            ) : (
              <span className="text-xs text-slate-500">needs its overview — see General</span>
            )}
          </SettingRow>
        )}
        {host && (
          <SettingRow
            label="Remove the SSH connection"
            description="Takes Loskai's key and its sudo rule off the machine, then its entry out of the SSH config."
          >
            <button onClick={() => setRemoving(true)} className={`${BUTTON} text-rose-300`}>
              Remove
            </button>
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
        title={`Remove ${machine.name}'s SSH connection?`}
        confirmLabel="Remove"
        destructive
        onConfirm={() =>
          removeSsh.mutate({
            hostname, address: machine.upstream ?? "", name: machine.name, instance_id: machine.id, ssh: null,
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
            className="mt-3 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
          />
        )}
        {removeSsh.isError && (
          <span className="mt-2 block text-rose-400">
            {removeSsh.error instanceof ApiError ? removeSsh.error.message : "Couldn't remove it"}
          </span>
        )}
      </ConfirmDialog>

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
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
      </div>
    </div>
  );
}

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
