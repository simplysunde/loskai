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
}

// One row per routed service. Route-sync + live columns here; the DNS-rewrite column
// lands in Phase 4 and per-row assign/delete/private actions in Phase 6.
export function ServiceTable({ rows }: { rows: RouteRow[] }) {
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
