import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { formatBytes, formatUptime } from "../../lib/format";
import { SELF_UPDATING_REASON, tailscaleStatus, updatesItself, type Facts } from "../../lib/ssh";
import { Hint } from "../shared/Hint";

const UPDATES_HINT = "From the machine's own package lists, as last refreshed — nothing is fetched.";

// A machine's overview: what it runs as, how full it is, what is waiting, its Tailscale
// address — and beside it, `actions`: what is done to the machine itself (System's Update,
// Reboot, Shut down). Its tmux sessions and projects are on the tools' cards. An older status
// line has none — then the reinstall is offered.
export function MachineOverview({
  facts,
  actions,
  onReinstall,
}: {
  facts: Facts | undefined;
  actions?: ReactNode;
  onReinstall: () => void;
}) {
  if (!facts) return <Loader2 className="h-4 w-4 animate-spin text-slate-500" />;
  if (!facts.ok) {
    return (
      <p className="text-xs text-amber-300">
        {facts.error}
        {facts.old && (
          <button onClick={onReinstall} className="ml-2 text-teal-400 hover:underline">
            Install again
          </button>
        )}
      </p>
    );
  }

  const memory = facts.memory;
  const updates = facts.updates;
  return (
    <div className="space-y-3 text-sm">
      {/* The actions in the room right of the facts; on a phone, under them. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <dl className="grid min-w-0 grid-cols-[7rem_1fr] gap-y-1.5">
        <dt className="text-slate-500">System</dt>
        <dd className="text-slate-300">
          {facts.os ?? "—"} <span className="whitespace-nowrap text-xs text-slate-500">{facts.kernel}</span>
        </dd>
        <dt className="text-slate-500">Up</dt>
        <dd className="text-slate-300">{formatUptime(facts.uptime)}</dd>
        <dt className="text-slate-500">
          <Hint text={UPDATES_HINT}>Updates</Hint>
        </dt>
        <dd className="text-slate-300">
          {!updates ? (
              "—"
            ) : updatesItself(facts) ? (
              <span>
                updates itself{" "}
                <Hint text={`${SELF_UPDATING_REASON} (${updates.manager}), applied when it restarts — Loskai leaves it alone`} className="text-xs text-slate-500">
                  ({updates.manager})
                </Hint>
              </span>
            ) : updates.count === 0 ? (
              "up to date"
            ) : (
              <span className="text-amber-300">
                {updates.count} waiting <span className="text-xs text-slate-500">({updates.manager})</span>
              </span>
            )}
        </dd>
        {facts.programs?.includes("tailscale") && (
          <>
            <dt className="text-slate-500">Tailscale</dt>
            <dd className="font-mono text-slate-300">
              {tailscaleStatus(facts) === facts.tailscale ? (
                facts.tailscale
              ) : (
                <span className="font-sans text-slate-500">{tailscaleStatus(facts)}</span>
              )}
            </dd>
          </>
        )}
      </dl>
      {/* A column of one width beside the facts, about as tall as they are; on a phone a row. */}
      {actions && <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:gap-1.5">{actions}</div>}
      </div>

      <div className="space-y-1.5">
        {memory?.available != null && (
          <Usage label="Memory" used={memory.total - memory.available} size={memory.total} />
        )}
        {(facts.disks ?? []).map((d) => (
          <Usage key={d.device} label={d.mount} title={d.device} used={d.used} size={d.size} />
        ))}
      </div>

      {facts.outdated && (
        <p className="w-fit text-xs text-slate-500">
          Its status line is{" "}
          <Hint text="Still read as before. Installing again brings what changed since.">
            older than this Loskai
          </Hint>
          .
          <button onClick={onReinstall} className="ml-2 text-teal-400 hover:underline">
            Install again
          </button>
        </p>
      )}
    </div>
  );
}

function Usage({ label, title, used, size }: { label: string; title?: string; used: number; size: number }) {
  const pct = size > 0 ? Math.min(100, (used / size) * 100) : 0;
  const tone = pct >= 90 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-teal-500";
  return (
    <div className="grid grid-cols-[7rem_1fr_9rem] items-center gap-3 text-xs">
      <span title={title} className="truncate font-mono text-slate-400">{label}</span>
      <div className="h-1.5 rounded bg-slate-800">
        <div className={`h-1.5 rounded ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-right text-slate-500">
        {formatBytes(used)} / {formatBytes(size)}
      </span>
    </div>
  );
}
