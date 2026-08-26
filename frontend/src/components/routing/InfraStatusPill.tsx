import type { ReactNode } from "react";
import { ExternalLink, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";

import type { ModuleHealth, ModuleState } from "../../lib/useHealth";
import { StatusBadge } from "../shared/StatusBadge";

const STATUS_LABEL: Record<ModuleState, string> = {
  healthy: "online",
  degraded: "degraded",
  unreachable: "unreachable",
  unconfigured: "not configured",
};

// One slim always-visible row for an infrastructure service Loskai pushes state to
// (AdGuard, Caddy): health + a link out to its own UI — the important bit, since Loskai is a
// thin companion, not a replacement. Persistent rather than problem-only so the link-out is
// always reachable; when the service has no URL yet the link becomes "Configure", pointing at
// the settings category that fixes it.
export function InfraStatusPill({
  icon,
  name,
  health,
  url,
  linkLabel,
  action,
  children,
}: {
  icon: ReactNode;
  name: string;
  health?: ModuleHealth;
  url?: string | null;
  linkLabel: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const status = health?.status ?? "unconfigured";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2.5">
      <span className="shrink-0 text-slate-400">{icon}</span>
      <span className="shrink-0 text-sm font-medium text-slate-200">{name}</span>
      <StatusBadge status={status} label={STATUS_LABEL[status]} />
      {children}
      {status !== "healthy" && health?.detail && (
        <span className="truncate text-xs text-slate-500">{health.detail}</span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {action}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            {linkLabel} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <Link
            to="/settings/network"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            Configure <Settings2 className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
