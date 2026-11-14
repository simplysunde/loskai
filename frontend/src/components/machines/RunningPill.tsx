import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { TargetKind } from "../../lib/tools";
import { runningCount, type Running } from "../../lib/ssh";

const DENIED: Record<string, string> = {
  docker: "containers",
  pct: "LXCs",
  qm: "VMs",
};

// How many things run on a machine; a click lists them all, with what can be done to each
// (`actions`: a route on a port, naming a guest). The card is portalled to the body and
// `fixed` at the pill, because the table scrolls sideways and would clip it. Esc, a click
// outside it, or one of its buttons closes it.
export function RunningPill({
  running,
  user,
  actions,
}: {
  running: Running;
  user?: string;
  actions?: (target: TargetKind, id: string) => React.ReactNode;
}) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!at) return;
    // Scrolling the page would leave the card behind; scrolling inside it is the list.
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!pill.current?.contains(t) && !card.current?.contains(t)) setAt(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAt(null);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("scroll", away, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("scroll", away, true);
      document.removeEventListener("keydown", esc);
    };
  }, [at]);

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

  // Wider with a column of buttons; on a screen too narrow for it (a phone), 8px from each side.
  const width = actions ? 448 : 384;
  const toggle = (el: HTMLElement) => {
    if (at) return setAt(null);
    const r = el.getBoundingClientRect();
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 16)), top: r.bottom + 4 });
  };
  return (
    <>
      <button
        ref={pill}
        type="button"
        aria-expanded={at !== null}
        onClick={(e) => toggle(e.currentTarget)}
        className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300 outline-none hover:bg-emerald-500/20 focus:ring-1 focus:ring-teal-500"
      >
        {runningCount(running)} running
      </button>
      {at &&
        createPortal(
          <div
            ref={card}
            role="dialog"
            aria-label="Running"
            // A button in it opens a dialog of its own (Add route, Name a machine), so it goes.
            onClick={(e) => (e.target as HTMLElement).closest("button") && setAt(null)}
            style={{ left: at.left, top: at.top, width }}
            className="fixed z-50 max-h-80 max-w-[calc(100vw-1rem)] overflow-auto rounded-lg border border-slate-700 bg-slate-900 text-xs text-slate-300 shadow-2xl"
          >
            <RunningList running={running} user={user} actions={actions} />
          </div>,
          document.body,
        )}
    </>
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
  actions?: (target: TargetKind, id: string) => React.ReactNode;
}) {
  const containers = running.containers ?? [];
  const services = running.services ?? [];
  const guests = running.guests ?? [];
  const columns = actions ? 3 : 2;
  const row = (key: string, name: string, status: React.ReactNode, buttons: React.ReactNode, title?: string) => (
    <tr key={key} className="border-t border-slate-800 hover:bg-slate-900/40">
      <td title={title} className="max-w-0 truncate px-4 py-2 text-sm text-slate-200">
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
      {(running.denied ?? []).filter((d) => d in DENIED).map((d) => (
        <p key={d} className="border-t border-slate-800 px-4 py-2.5 text-amber-300">
          {user ?? "The SSH user"} may not list {DENIED[d]} — give it the rights, or sudo.
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
