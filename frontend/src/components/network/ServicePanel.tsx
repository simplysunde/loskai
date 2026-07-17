import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import type { ModuleState } from "../../lib/useHealth";
import { StatusBadge } from "../shared/StatusBadge";

const STATUS_LABEL: Record<ModuleState, string> = {
  healthy: "online",
  degraded: "degraded",
  unreachable: "unreachable",
  unconfigured: "not configured",
};

// One service card for the Network tab: icon + name + health, an optional body, and a
// link-out button (disabled when the URL is unknown). Presentational — the page feeds it
// health + settings.
export function ServicePanel({
  icon,
  name,
  subtitle,
  status,
  linkUrl,
  linkLabel,
  children,
}: {
  icon: ReactNode;
  name: string;
  subtitle: string;
  status: ModuleState;
  linkUrl?: string | null;
  linkLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-slate-100">{name}</div>
          <div className="truncate text-xs text-slate-500">{subtitle}</div>
        </div>
        <StatusBadge status={status} label={STATUS_LABEL[status]} />
      </div>

      {children && <div className="mt-4 flex-1">{children}</div>}

      <a
        href={linkUrl ?? undefined}
        target="_blank"
        rel="noreferrer"
        className={`mt-4 flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium ${
          linkUrl
            ? "bg-teal-600 text-white hover:bg-teal-500"
            : "pointer-events-none bg-slate-800 text-slate-500"
        }`}
      >
        {linkLabel} <ExternalLink className="h-4 w-4" />
      </a>
    </div>
  );
}
