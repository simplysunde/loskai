import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { runningCount, type Running } from "../../lib/ssh";

const DENIED: Record<string, string> = {
  docker: "containers",
  pct: "LXCs",
  qm: "VMs",
};

// How many things run on a machine; hovering (or focusing) lists them all. The card is
// portalled to the body and `fixed` at the pill, because the table scrolls sideways and
// would clip it; it stays open while the pointer is on it, so a long list can scroll.
export function RunningPill({ running, user }: { running: Running; user?: string }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const closing = useRef<number | undefined>(undefined);
  const keep = () => window.clearTimeout(closing.current);
  const close = () => {
    keep();
    closing.current = window.setTimeout(() => setAt(null), 150);
  };

  if (!running.ok) {
    return (
      <span
        title={running.error}
        className="cursor-help rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300"
      >
        unreachable
      </span>
    );
  }

  const show = (el: HTMLElement) => {
    keep();
    const r = el.getBoundingClientRect();
    setAt({ left: Math.min(r.left, window.innerWidth - 300), top: r.bottom + 4 });
  };
  const containers = running.containers ?? [];
  const services = running.services ?? [];
  const guests = running.guests ?? [];

  return (
    <span
      tabIndex={0}
      onMouseEnter={(e) => show(e.currentTarget)}
      onFocus={(e) => show(e.currentTarget)}
      onMouseLeave={close}
      onBlur={close}
      className="cursor-help rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300 outline-none focus:ring-1 focus:ring-teal-500"
    >
      {runningCount(running)} running
      {at &&
        createPortal(
          <div
            role="tooltip"
            onMouseEnter={keep}
            onMouseLeave={close}
            style={{ left: at.left, top: at.top }}
            className="fixed z-50 max-h-80 w-72 overflow-auto rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs text-slate-300 shadow-2xl"
          >
            {containers.length > 0 && (
              <Group title={`Containers (${containers.length})`}>
                {containers.map((c) => (
                  <li key={c.name} title={c.image} className="flex justify-between gap-2">
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 text-slate-500">{c.status}</span>
                  </li>
                ))}
              </Group>
            )}
            {guests.length > 0 && (
              <Group title={`Guests (${guests.length})`}>
                {guests.map((g) => (
                  <li key={g.id} className="flex justify-between gap-2">
                    <span className="truncate">{g.name}</span>
                    <span className="shrink-0 text-slate-500">
                      {g.kind === "vm" ? "VM" : "LXC"} {g.id}
                    </span>
                  </li>
                ))}
              </Group>
            )}
            {services.length > 0 && (
              <Group title={`Services (${services.length})`}>
                {services.map((s) => (
                  <li key={s} className="truncate">
                    {s}
                  </li>
                ))}
              </Group>
            )}
            {runningCount(running) === 0 && <p className="text-slate-500">Nothing besides the system.</p>}
            {(running.hidden ?? 0) > 0 && (
              <p className="mt-2 text-slate-500">+ {running.hidden} system services</p>
            )}
            {(running.denied ?? []).map((d) => (
              <p key={d} className="mt-2 text-amber-300">
                {user ?? "The SSH user"} may not list {DENIED[d] ?? d} — give it the rights, or sudo.
              </p>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 last:mb-0">
      <p className="mb-1 font-medium text-slate-400">{title}</p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}
