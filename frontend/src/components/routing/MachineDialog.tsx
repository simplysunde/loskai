import { useState, type ComponentType, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Boxes,
  HardDrive,
  KeyRound,
  Loader2,
  ScrollText,
  SlidersHorizontal,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { apiMessage } from "../../lib/api";
import { useInstances } from "../../lib/routes";
import { useSettings } from "../../lib/settings";
import { keysSummary, useFacts, useRunning, useSsh } from "../../lib/ssh";
import { toolContext } from "../../lib/toolRows";
import { applies, MACHINE_TOOL, useTools, type TargetKind } from "../../lib/tools";
import { useMe } from "../../lib/useAuth";
import { assembleFqdn, isValidDnsOnlyPrefix, isValidDnsTarget, isValidPort, SSH_USER } from "../../lib/validation";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { Overlay } from "../shared/Modal";
import { SudoRuleSwitch } from "./SudoRuleSwitch";
import { SectionPane } from "../shared/SectionPane";
import { InlineText, SettingRow, Switch } from "../shared/SettingRow";
import { SshLog } from "../settings/SshLog";
import type { NewMachine } from "./AddMachineModal";
import { isMachine } from "./machine";
import { MachineOverview } from "./MachineOverview";
import { AddToolMenu, MachineTools, OwnButtons, RowButtons } from "./MachineTools";
import { EnableSshModal } from "./EnableSshModal";
import { RunningList } from "./RunningPill";
import { SaveBanner } from "./SaveBanner";
import { SshKeys } from "./SshKeys";
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
    words: "name hostname address ip moved routes overview system os kernel uptime memory disks updates tailscale update reboot restart shut down power off",
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
  const { admin } = useMe();
  const handed = (useLocation().state ?? {}) as MachineState;
  const [result, setResult] = useState<SaveResult | null>(handed.result ?? null);
  const [setup, setSetup] = useState(Boolean(handed.setup));
  const [removing, setRemoving] = useState(false);
  const [enabling, setEnabling] = useState(false);
  // Its own SSH keys, every one, in the dialog Git's Keys opens — from the SSH section.
  const [ownKeys, setOwnKeys] = useState(false);
  // Your password, when removing the connection needs Loskai's key unlocked.

  const routes = useInstances();
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
  // needs the key unlocked: while it is locked, the save asks for your password (api.ts).
  const removeSsh = useMutation({
    mutationFn: (change: NewMachine) => save.mutateAsync(change),
    onSuccess: () => setRemoving(false),
  });

  const machine = routes.data?.find((r) => r.id === id && isMachine(r));
  const runner = useToolRunner(machine && { id: machine.id, name: machine.name }, ssh.data?.key ?? null);
  const close = () => navigate("/machines");

  // Opened at a section (/machines/<id>/ssh): start there, once the sections are drawn — or
  // at General, when it isn't one this machine or account has.
  const ready = Boolean(machine && ssh.data);

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
  const ctx = toolContext(id, tools.data, facts.data, ssh.data, runner.start);
  const gitTool = tools.data?.find((t) => t.id === "git");
  // System's Update, Reboot and Shut down are the machine's own: on General, by its overview.
  const system = here.find((t) => t.id === MACHINE_TOOL);
  const rowActions = (target: TargetKind, name: string) => (
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

  // The log is an admin's, as every log is.
  const available = SECTIONS.filter((s) => (s.group === 0 || host?.user) && (s.id !== "log" || admin));
  // The search finds Tools by the names of the tools too.
  const toolNames = (tools.data ?? []).map((t) => t.name).join(" ");

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
            <MachineOverview
              facts={facts.data}
              actions={ctx && system && <OwnButtons tool={system} ctx={ctx} />}
              onReinstall={() => setSetup(true)}
            />
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
              validate={(v) => (isValidPort(v) ? null : "A port from 1 to 65535.")}
              onSave={(v) => post({ ssh: { user: host.user!, port: Number(v) } })}
            />
          </SettingRow>
        )}
        {host?.user && (
          <SettingRow label="Keys" description="Its host key and Loskai's key on it — SSH setup; and its own keys, in ~/.ssh.">
            {trusted ? (
              <span className="text-xs text-emerald-300">set up</span>
            ) : (
              <span className="text-xs text-amber-300">not set up</span>
            )}
            <button onClick={() => setSetup(true)} className={`${BUTTON} text-slate-200`}>
              {trusted ? "SSH setup" : "Set up SSH"}
            </button>
            {/* Its own keys — every one, as Git's Keys shows git's. Their buttons are Git's
                tool's, so a machine without git lists them only. */}
            {ctx && facts.data?.ok && (
              <button
                onClick={() => setOwnKeys(true)}
                aria-haspopup="dialog"
                title={facts.data.ssh_keys ? `Its own SSH keys: ${keysSummary(facts.data)}` : "Its own SSH keys — its status line is older: install it again to list them"}
                className={`${BUTTON} text-slate-200`}
              >
                <KeyRound className="h-3.5 w-3.5" /> Keys{facts.data.ssh_keys ? ` (${facts.data.ssh_keys.length})` : ""}
              </button>
            )}
          </SettingRow>
        )}
        {host?.user && trusted && (
          <SettingRow
            label="Updates without a password"
            description="System's Update runs without asking: a sudo rule on the machine for exactly its update commands."
          >
            <SudoRuleSwitch user={host.user} facts={facts.data} onRun={runner.start} />
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
            {/* Not on a phone: General has both, and the name needs the room. */}
            <span className="hidden truncate font-mono text-xs font-normal text-slate-500 sm:inline">
              {machine.fqdn ?? "—"} · {machine.upstream ?? "—"}
            </span>
          </span>
        }
        action={
          trusted && host?.user ? (
            <button onClick={runner.openShell} title="Terminal" className={`${BUTTON} text-slate-200`}>
              <Terminal className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Terminal</span>
            </button>
          ) : null
        }
        onClose={close}
      >
        <SectionPane
          sections={available.map((s) => ({
            ...s,
            words: s.id === "tools" ? `${s.words} ${toolNames}` : s.words,
            action: headingActions[s.id],
            content: content[s.id],
          }))}
          start={section}
          ready={ready}
          top={result && <div className="pt-4"><SaveBanner result={result} /></div>}
        />
      </Shell>

      <ConfirmDialog
        open={removing}
        title={`Turn off SSH for ${machine.name}?`}
        confirmLabel="Turn off"
        destructive
        pending={removeSsh.isPending}
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
        {removeSsh.isError && (
          <span className="mt-2 block text-rose-400">
            {apiMessage(removeSsh.error, "Couldn't turn it off")}
          </span>
        )}
      </ConfirmDialog>

      {enabling && (
        <EnableSshModal
          name={machine.name}
          onClose={() => setEnabling(false)}
          onSave={async (login) => {
            await post({ ssh: login });
            setEnabling(false);
          }}
        />
      )}

      {/* Shown once the SSH config has the login: just after a save, on its refetch. */}
      {setup && host?.user && ssh.data?.targets[machine.id] && (
        <SshSetupModal
          machine={{ id: machine.id, name: machine.name }}
          user={host.user}
          target={ssh.data.targets[machine.id]}
          sshKey={ssh.data?.key ?? null}
          onClose={() => setSetup(false)}
        />
      )}

      {ownKeys && ctx && gitTool && (
        <SshKeys
          tool={applies(gitTool, ctx.facts.programs ?? []) ? gitTool : { ...gitTool, actions: [] }}
          ctx={ctx}
          mode="machine"
          onClose={() => setOwnKeys(false)}
        />
      )}
      {runner.ui}
    </>
  );
}

// A dialog with a side menu (SectionPane) under its title — this one's, and Projects'.
export function Shell({
  label,
  title,
  action,
  wide = false,
  onClose,
  children,
}: {
  label: string;
  title: ReactNode;
  action?: ReactNode;
  // Room for a table's columns (Projects').
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Overlay
      onClose={onClose}
      label={label}
      className={`flex h-full w-full ${wide ? "max-w-6xl" : "max-w-4xl"} flex-col overflow-hidden sm:h-[85vh] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl`}
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
