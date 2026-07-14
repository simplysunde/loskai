import type { ModuleState } from "../../lib/useHealth";

const STYLES: Record<string, string> = {
  healthy: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  degraded: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  unreachable: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  unconfigured: "bg-slate-500/15 text-slate-400 ring-slate-500/30",
  synced: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  unsynced: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  unknown: "bg-slate-500/15 text-slate-400 ring-slate-500/30",
};

export function StatusBadge({
  status,
  label,
}: {
  status: ModuleState | string;
  label?: string;
}) {
  const cls = STYLES[status] ?? STYLES.unknown;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label ?? status}
    </span>
  );
}
