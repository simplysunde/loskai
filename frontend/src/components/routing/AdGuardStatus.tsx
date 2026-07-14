import { ExternalLink, Shield } from "lucide-react";

import type { ModuleHealth } from "../../lib/useHealth";
import { StatusBadge } from "../shared/StatusBadge";

// AdGuard health pill + a prominent link out to the full AdGuard UI (the most important
// feature — Loskai is a thin companion, not a replacement). Shown in the Routing header.
export function AdGuardStatus({ health }: { health?: ModuleHealth }) {
  const status = health?.status ?? "unconfigured";
  const url = health?.url ?? null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2.5">
      <Shield className="h-4 w-4 text-slate-400" />
      <span className="text-sm font-medium text-slate-200">AdGuard</span>
      <StatusBadge status={status} />
      {health?.answer_ip && (
        <span className="text-xs text-slate-500">
          answers → <span className="font-mono text-slate-400">{health.answer_ip}</span>
        </span>
      )}
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        className={`ml-auto flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs ${
          url
            ? "text-slate-300 hover:bg-slate-800"
            : "pointer-events-none text-slate-600"
        }`}
      >
        Open AdGuard <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
