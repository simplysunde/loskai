import { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { useFacts, useSsh } from "../../lib/ssh";
import { commandFor, MACHINE_TOOL, useTools } from "../../lib/tools";
import { Modal } from "../shared/Modal";
import { SudoRuleSwitch } from "./SudoRuleSwitch";
import { useToolRunner } from "./useToolRunner";

type Machine = { id: string; name: string; subdomain?: string | null };

const RUN = { tool: MACHINE_TOOL, action: "update", title: "Update" };

// Every machine with SSH set up, brought up to date from the Machines tab: each with what
// waits there and its own Update, and Update all — System's Update on each in turn, one
// after the other ends (a sudo password asked for each that needs one). What waits is read
// again as each ends: "up to date" is the machine's word, not the run's. Beside each, the
// switch for updates without a password: on, Update all goes past that machine without
// stopping to ask.
export function UpdateAll({ machines, onClose }: { machines: Machine[]; onClose: () => void }) {
  const ssh = useSsh();
  const set = machines.filter((m) => ssh.data?.trusted[m.id]);
  // The machines still to update, in order; the first one's run is under way.
  const [queue, setQueue] = useState<string[]>([]);
  const next = () => setQueue((q) => q.slice(1));
  return (
    <Modal title="Update all" onClose={onClose}>
      <div className="space-y-4 overflow-y-auto p-5">
        <p className="text-sm text-slate-400">
          Refresh each machine's package lists, then install every update — one machine after
          another.
        </p>
        {!ssh.data ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
            {set.map((m) => (
              <MachineUpdate
                key={m.id}
                machine={m}
                turn={queue[0] === m.id}
                queued={queue.indexOf(m.id) > 0}
                busy={queue.length > 0}
                onEnd={next}
              />
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          {queue.length > 1 && (
            <button
              type="button"
              onClick={() => setQueue((q) => q.slice(0, 1))}
              title="The one updating now carries on; the rest are left"
              className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Stop after this one
            </button>
          )}
          <button
            type="button"
            disabled={queue.length > 0 || set.length === 0}
            onClick={() => setQueue(set.map((m) => m.id))}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {queue.length > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Update all
          </button>
        </div>
      </div>
    </Modal>
  );
}

// One machine: what waits there, and its Update — started by Update all on its `turn`; one
// that can't be updated (unread, no command for its package manager) is passed over.
function MachineUpdate({
  machine,
  turn,
  queued,
  busy,
  onEnd,
}: {
  machine: Machine;
  turn: boolean;
  queued: boolean;
  busy: boolean;
  onEnd: () => void;
}) {
  const ssh = useSsh();
  const tools = useTools();
  const facts = useFacts(machine.id, true, false);
  const runner = useToolRunner(machine, ssh.data?.key ?? null, onEnd);
  const action = tools.data?.find((t) => t.id === MACHINE_TOOL)?.actions.find((a) => a.id === RUN.action);
  const f = facts.data;
  const user = machine.subdomain ? ssh.data?.hosts[machine.subdomain]?.user : undefined;
  const command = f?.ok && action ? commandFor(action, f.updates?.manager) : null;
  const read = !facts.isLoading && Boolean(tools.data);

  // Its turn starts its run once; what it can't run hands the turn on.
  const started = useRef(false);
  useEffect(() => {
    if (!turn) {
      started.current = false;
      return;
    }
    if (started.current || !read) return;
    started.current = true;
    if (command && action) runner.start(RUN, action);
    else onEnd();
  }, [turn, read, command, action, runner, onEnd]);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className="font-medium text-slate-100">{machine.name}</span>
      <span className="text-xs text-slate-500">
        {!f ? (
          facts.isError ? "couldn't read it" : <Loader2 className="inline h-3 w-3 animate-spin" />
        ) : !f.ok ? (
          <span className="text-amber-300">{f.error}</span>
        ) : !f.updates ? (
          "—"
        ) : f.updates.count === 0 ? (
          "up to date"
        ) : (
          <span className="text-amber-300">
            {f.updates.count} waiting <span className="text-slate-500">({f.updates.manager})</span>
          </span>
        )}
      </span>
      <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
        {user && command && (
          <span title="Passwordless sudo, for exactly the update commands — on, Update runs without asking for sudo's password" className="flex items-center gap-1.5">
            {/* Root's note says it alone. */}
            {user !== "root" && <span className="max-sm:hidden">Passwordless sudo</span>}
            <SudoRuleSwitch user={user} facts={f} onRun={runner.start} disabled={busy} short />
          </span>
        )}
        {turn ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating
          </>
        ) : queued ? (
          "Queued"
        ) : (
          <button
            type="button"
            disabled={!command || busy}
            onClick={() => action && runner.start(RUN, action)}
            title={command ? `${action?.description}\n$ ${command}` : "No command for its package manager"}
            aria-label={`Update ${machine.name}`}
            className="flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3 w-3" /> Update
          </button>
        )}
      </span>
      {runner.ui}
    </li>
  );
}
