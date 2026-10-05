import type { ReactNode } from "react";
import { ExternalLink, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";

import type { ModuleHealth, ModuleState } from "../../lib/useHealth";
import { StatusBadge } from "../shared/StatusBadge";

export const ICON_BUTTON =
  "flex items-center rounded-md border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800";

const STATUS_LABEL: Record<ModuleState, string> = {
  healthy: "online",
  degraded: "degraded",
  unreachable: "unreachable",
  unconfigured: "not configured",
};

// One compact always-visible strip for an infrastructure service Loskai pushes state to
// (AdGuard, Caddy): health + a link out to its own UI — the important bit, since Loskai is a
// thin companion, not a replacement. Persistent rather than problem-only so the link-out is
// always reachable; when the service has no URL yet the link becomes "Configure", pointing at
// the settings category that fixes it. Narrow enough for two to share a row, so the links
// are icon buttons — their label is the tooltip and the accessible name.
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
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-1.5">
      <span className="shrink-0 text-slate-400">{icon}</span>
      <span className="shrink-0 text-sm font-medium text-slate-200">{name}</span>
      <StatusBadge status={status} label={STATUS_LABEL[status]} />
      {children}
      {status !== "healthy" && health?.detail && (
        <span title={health.detail} className="min-w-0 truncate text-xs text-slate-500">
          {health.detail}
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {action}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            title={linkLabel}
            aria-label={linkLabel}
            className={ICON_BUTTON}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <Link to="/settings/network" title="Configure" aria-label="Configure" className={ICON_BUTTON}>
            <Settings2 className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
