import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ToolTarget } from "../../lib/tools";
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
    // On a screen too narrow for the card (a phone), it shrinks to 8px from each side.
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - 400)), top: r.bottom + 4 });
  };
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
            className="fixed z-50 max-h-80 w-96 max-w-[calc(100vw-1rem)] overflow-auto rounded-lg border border-slate-700 bg-slate-900 text-xs text-slate-300 shadow-2xl"
          >
            <RunningList running={running} user={user} />
          </div>,
          document.body,
        )}
    </span>
  );
}

// Everything that runs on a machine, by kind, as a table — the pill's card, and the
// machine's page, where `actions` adds a column with the buttons of the tools that apply.
export function RunningList({
  running,
  user,
  actions,
}: {
  running: Running;
  user?: string;
  actions?: (target: ToolTarget, id: string) => React.ReactNode;
}) {
  const containers = running.containers ?? [];
  const services = running.services ?? [];
  const guests = running.guests ?? [];
  const columns = actions ? 3 : 2;
  const row = (key: string, name: string, status: React.ReactNode, buttons: React.ReactNode, title?: string) => (
    <tr key={key} title={title} className="border-t border-slate-800 hover:bg-slate-900/40">
      <td className="max-w-0 truncate px-4 py-2 text-sm text-slate-200">
        {name}
        {/* On a phone the status goes under the name, leaving the name the room. */}
        {status && <span className="block truncate text-xs text-slate-500 sm:hidden">{status}</span>}
      </td>
      <td className="whitespace-nowrap py-2 text-slate-500 sm:px-4">
        <span className="hidden sm:inline">{status}</span>
      </td>
      {actions && (
        <td className="py-2 pr-3 sm:px-4">
          <span className="flex flex-wrap justify-end gap-1.5">{buttons}</span>
        </td>
      )}
    </tr>
  );
  return (
    <>
      {runningCount(running) > 0 && (
        <table className="w-full table-fixed text-left text-xs">
          <colgroup>
            <col />
            <col className="w-0 sm:w-36" />
            {actions && <col className="w-36 sm:w-44" />}
          </colgroup>
          {containers.length > 0 && (
            <Group title={`Containers (${containers.length})`} columns={columns}>
              {containers.map((c) => row(c.name, c.name, c.status, actions?.("container", c.name), c.image))}
            </Group>
          )}
          {guests.length > 0 && (
            <Group title={`Guests (${guests.length})`} columns={columns}>
              {guests.map((g) =>
                row(g.id, g.name, `${g.kind === "vm" ? "VM" : "LXC"} ${g.id}`, actions?.(g.kind, g.id)),
              )}
            </Group>
          )}
          {services.length > 0 && (
            <Group title={`Services (${services.length})`} columns={columns}>
              {services.map((s) => row(s, s, "", actions?.("service", s)))}
            </Group>
          )}
        </table>
      )}
      {runningCount(running) === 0 && <p className="px-4 py-2.5 text-slate-500">Nothing besides the system.</p>}
      {(running.hidden ?? 0) > 0 && (
        <p className="border-t border-slate-800 px-4 py-2.5 text-slate-500">+ {running.hidden} system services</p>
      )}
      {(running.denied ?? []).map((d) => (
        <p key={d} className="border-t border-slate-800 px-4 py-2.5 text-amber-300">
          {user ?? "The SSH user"} may not list {DENIED[d] ?? d} — give it the rights, or sudo.
        </p>
      ))}
    </>
  );
}

// A kind's rows, under a heading row like the Machines table's header.
function Group({ title, columns, children }: { title: string; columns: number; children: React.ReactNode }) {
  return (
    <tbody>
      <tr className="border-t border-slate-800 [tbody:first-of-type>&]:border-t-0">
        <th colSpan={columns} className="px-4 py-2.5 font-medium uppercase text-slate-500">
          {title}
        </th>
      </tr>
      {children}
    </tbody>
  );
}
