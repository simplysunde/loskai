import { Loader2 } from "lucide-react";

import { formatBytes, formatUptime } from "../../lib/format";
import type { Facts } from "../../lib/ssh";

const UPDATES_HINT = "From the machine's own package lists, as last refreshed — nothing is fetched.";

// A machine's overview: what it runs as, how full it is, what is waiting, its tmux
// sessions. An older status line has none — then the reinstall is offered.
export function MachineOverview({
  facts,
  onReinstall,
}: {
  facts: Facts | undefined;
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
      <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5">
        <dt className="text-slate-500">System</dt>
        <dd className="text-slate-300">
          {facts.os ?? "—"} <span className="text-xs text-slate-500">{facts.kernel}</span>
        </dd>
        <dt className="text-slate-500">Up</dt>
        <dd className="text-slate-300">{formatUptime(facts.uptime)}</dd>
        <dt className="text-slate-500">Updates</dt>
        <dd title={UPDATES_HINT} className="cursor-help text-slate-300">
          {!updates ? (
            "—"
          ) : updates.count === 0 ? (
            "up to date"
          ) : (
            <span className="text-amber-300">
              {updates.count} waiting <span className="text-xs text-slate-500">({updates.manager})</span>
            </span>
          )}
        </dd>
      </dl>

      <div className="space-y-1.5">
        {memory?.available != null && (
          <Usage label="Memory" used={memory.total - memory.available} size={memory.total} />
        )}
        {(facts.disks ?? []).map((d) => (
          <Usage key={d.device} label={d.mount} title={d.device} used={d.used} size={d.size} />
        ))}
      </div>

      {facts.tmux && facts.tmux.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-400">tmux sessions</p>
          <ul className="space-y-0.5 text-xs text-slate-300">
            {facts.tmux.map((s) => (
              <li key={s.name} className="flex justify-between gap-2">
                <span className="font-mono">{s.name}</span>
                <span className="text-slate-500">
                  {s.windows} {s.windows === 1 ? "window" : "windows"}
                  {s.attached ? " · attached" : ""} · since{" "}
                  {new Date(s.created * 1000).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Usage({ label, title, used, size }: { label: string; title?: string; used: number; size: number }) {
  const pct = size > 0 ? Math.min(100, (used / size) * 100) : 0;
  const tone = pct >= 90 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-teal-500";
  return (
    <div title={title} className="grid grid-cols-[7rem_1fr_9rem] items-center gap-3 text-xs">
      <span className="truncate font-mono text-slate-400">{label}</span>
      <div className="h-1.5 rounded bg-slate-800">
        <div className={`h-1.5 rounded ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-right text-slate-500">
        {formatBytes(used)} / {formatBytes(size)}
      </span>
    </div>
  );
}
