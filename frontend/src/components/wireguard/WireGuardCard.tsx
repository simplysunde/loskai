import { ExternalLink, Info, Shield } from "lucide-react";

import type { ModuleHealth } from "../../lib/useHealth";
import { StatusBadge } from "../shared/StatusBadge";

// The whole WireGuard module UI: a reachability card + link-out + a persistent DNS
// reminder (the most common misconfiguration). Loskai does not manage peers — that
// stays in wg-dashboard.
export function WireGuardCard({ health }: { health?: ModuleHealth }) {
  const status = health?.status ?? "unconfigured";
  const url = health?.url ?? null;
  const dnsHint = health?.dns_hint ?? null;

  return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
            <Shield className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-slate-100">wg-dashboard</div>
            <div className="text-xs text-slate-500">
              {url ?? "Set WIREGUARD_DASHBOARD_URL in Settings"}
            </div>
          </div>
          <StatusBadge status={status} label={statusLabel(status)} />
        </div>

        <a
          href={url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className={`mt-4 flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium ${
            url
              ? "bg-teal-600 text-white hover:bg-teal-500"
              : "pointer-events-none bg-slate-800 text-slate-500"
          }`}
        >
          Open wg-dashboard <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <Info className="h-4 w-4 text-slate-400" /> Peer DNS reminder
        </div>
        <p className="mt-2 text-sm text-slate-400">
          So remote peers resolve names through AdGuard, set each peer's DNS to{" "}
          {dnsHint ? (
            <>
              <span className="font-mono text-teal-300">{dnsHint}</span> (AdGuard) plus{" "}
              <span className="font-mono text-slate-300">1.1.1.1</span> as a fallback.
            </>
          ) : (
            <>
              your AdGuard server's IP, plus{" "}
              <span className="font-mono text-slate-300">1.1.1.1</span> as a fallback.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === "healthy") return "online";
  if (status === "unreachable") return "unreachable";
  if (status === "unconfigured") return "not configured";
  return status;
}
