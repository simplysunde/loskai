import { Loader2, Plus, Trash2 } from "lucide-react";

import { StatusBadge } from "../shared/StatusBadge";

export interface RouteRow {
  id: string;
  name: string;
  type: "docker" | "external";
  subdomain: string | null;
  fqdn: string | null;
  upstream: string | null;
  private: boolean;
  synced: boolean | null;
  upstream_healthy: boolean | null;
  // Merged in from /api/adguard/status (Phase 4):
  dnsPresent?: boolean | null; // null = unknown (AdGuard down / no answer IP)
  dnsConflict?: boolean; // a manual same-domain rewrite points elsewhere
}

// One row per routed service. Route-sync, live, and DNS-rewrite columns; the per-row
// rewrite add/remove is best-effort. Assign/delete/private actions land in Phase 6.
export function ServiceTable({
  rows,
  onToggleRewrite,
  rewriteBusyId,
}: {
  rows: RouteRow[];
  onToggleRewrite?: (row: RouteRow) => void;
  rewriteBusyId?: string | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 py-12 text-center text-sm text-slate-500">
        No routes yet. Assigning a URL to a service will add it here.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">Service</th>
            <th className="px-4 py-2.5 font-medium">Upstream</th>
            <th className="px-4 py-2.5 font-medium">Route</th>
            <th className="px-4 py-2.5 font-medium">Live</th>
            <th className="px-4 py-2.5 font-medium">DNS</th>
            {onToggleRewrite && <th className="px-4 py-2.5 font-medium" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-900/40">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-100">{row.name}</div>
                <div className="text-xs text-slate-500">{row.fqdn ?? row.subdomain}</div>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-400">
                {row.upstream ?? "—"}
              </td>
              <td className="px-4 py-3">
                {row.synced === null ? (
                  <StatusBadge status="unknown" label="unknown" />
                ) : row.synced ? (
                  <StatusBadge status="synced" label="synced" />
                ) : (
                  <StatusBadge status="unsynced" label="not pushed" />
                )}
              </td>
              <td className="px-4 py-3">
                {row.upstream_healthy === null ? (
                  <span className="text-xs text-slate-600">—</span>
                ) : row.upstream_healthy ? (
                  <StatusBadge status="healthy" label="up" />
                ) : (
                  <StatusBadge status="unreachable" label="down" />
                )}
              </td>
              <td className="px-4 py-3">
                <DnsCell present={row.dnsPresent} conflict={row.dnsConflict} />
              </td>
              {onToggleRewrite && (
                <td className="px-4 py-3 text-right">
                  <RewriteAction
                    row={row}
                    busy={rewriteBusyId === row.id}
                    onToggle={onToggleRewrite}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DnsCell({
  present,
  conflict,
}: {
  present?: boolean | null;
  conflict?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {present === undefined || present === null ? (
        <StatusBadge status="unknown" label="unknown" />
      ) : present ? (
        <StatusBadge status="synced" label="rewrite set" />
      ) : (
        <StatusBadge status="unsynced" label="missing" />
      )}
      {conflict && <StatusBadge status="degraded" label="conflict" />}
    </div>
  );
}

function RewriteAction({
  row,
  busy,
  onToggle,
}: {
  row: RouteRow;
  busy: boolean;
  onToggle: (row: RouteRow) => void;
}) {
  // Can't act when DNS status is unknown (AdGuard down or no answer IP).
  const disabled = busy || row.dnsPresent === undefined || row.dnsPresent === null;
  const present = row.dnsPresent === true;
  return (
    <button
      disabled={disabled}
      onClick={() => onToggle(row)}
      title={present ? "Remove DNS rewrite" : "Add DNS rewrite"}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : present ? (
        <Trash2 className="h-3.5 w-3.5" />
      ) : (
        <Plus className="h-3.5 w-3.5" />
      )}
      {present ? "Rewrite" : "Rewrite"}
    </button>
  );
}
