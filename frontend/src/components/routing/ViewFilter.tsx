import type { RouteRow } from "./ServiceTable";

export type View = "all" | "services" | "machines" | "grouped";

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Everything, machines and services together" },
  { id: "services", label: "Services", hint: "Only things published at a URL" },
  { id: "machines", label: "Machines", hint: "Only named addresses" },
  { id: "grouped", label: "Grouped", hint: "Each machine followed by what runs on it" },
];

/** A machine is an address rather than a service: its upstream carries no port, which is
 *  what a `dns_only` assign stores. Same rule the backend links against. */
export function isMachine(row: RouteRow): boolean {
  return Boolean(row.upstream) && !row.upstream!.includes(":");
}

/** Order rows for a view. `grouped` puts each machine directly above the services linked
 *  to it, so the dependency reads top-to-bottom; anything unlinked follows. */
export function applyView(rows: RouteRow[], view: View): RouteRow[] {
  const byName = (a: RouteRow, b: RouteRow) => a.name.localeCompare(b.name);
  if (view === "services") return rows.filter((r) => !isMachine(r)).sort(byName);
  if (view === "machines") return rows.filter(isMachine).sort(byName);
  if (view !== "grouped") return [...rows].sort(byName);

  const machines = rows.filter(isMachine).sort(byName);
  const claimed = new Set<string>();
  const grouped: RouteRow[] = [];
  for (const machine of machines) {
    grouped.push(machine);
    claimed.add(machine.id);
    for (const dep of rows.filter((r) => r.machine === machine.id).sort(byName)) {
      grouped.push(dep);
      claimed.add(dep.id);
    }
  }
  // Services on no machine keep their place at the end rather than vanishing.
  return [...grouped, ...rows.filter((r) => !claimed.has(r.id)).sort(byName)];
}

export function ViewFilter({
  view,
  onChange,
  counts,
}: {
  view: View;
  onChange: (next: View) => void;
  counts: { services: number; machines: number };
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1 rounded-lg border border-slate-800 p-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => onChange(v.id)}
            title={v.hint}
            className={`rounded-md px-2.5 py-1 text-xs transition ${
              view === v.id
                ? "bg-teal-500/10 text-teal-200"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <span className="text-xs text-slate-600">
        {counts.services} {counts.services === 1 ? "service" : "services"} ·{" "}
        {counts.machines} {counts.machines === 1 ? "machine" : "machines"}
      </span>
    </div>
  );
}
