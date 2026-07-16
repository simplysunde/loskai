import { Eye, EyeOff, Loader2, Pencil, Plus, Trash2, Unlink } from "lucide-react";

import { StatusBadge } from "../shared/StatusBadge";

export interface RouteRow {
  id: string;
  name: string;
  type: "docker" | "external";
  subdomain: string | null;
  fqdn: string | null;
  upstream: string | null;
  upstream_tls?: boolean;
  private: boolean;
  routed: boolean;
  synced: boolean | null;
  upstream_healthy: boolean | null;
  // Merged in from /api/adguard/status (routed rows only):
  dnsPresent?: boolean | null;
  dnsConflict?: boolean;
}

// One row per instance (routed or not). Routed rows show route/DNS status + rewrite,
// private, and "remove route". Unrouted rows show "assign". External instances can be
// deleted outright; docker instances show the delete icon disabled (with a tooltip) since
// they're container-backed — their route is removed here, the instance via the Docker tab.
export function ServiceTable({
  rows,
  onAssign,
  onRemoveRoute,
  onDelete,
  actionBusyId,
  onToggleRewrite,
  rewriteBusyId,
  onTogglePrivate,
  privateBusyId,
}: {
  rows: RouteRow[];
  onAssign?: (row: RouteRow) => void;
  onRemoveRoute?: (row: RouteRow) => void;
  onDelete?: (row: RouteRow) => void;
  actionBusyId?: string | null;
  onToggleRewrite?: (row: RouteRow) => void;
  rewriteBusyId?: string | null;
  onTogglePrivate?: (row: RouteRow) => void;
  privateBusyId?: string | null;
}) {
  const hasActions = Boolean(onAssign || onRemoveRoute || onDelete || onToggleRewrite || onTogglePrivate);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 py-12 text-center text-sm text-slate-500">
        No services yet. Assign a URL to add one.
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
            {hasActions && <th className="px-4 py-2.5 font-medium text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-900/40">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2 font-medium text-slate-100">
                  {row.name}
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                    {row.type}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {row.fqdn ?? (
                    <span className="text-slate-600">not routed</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-400">
                {row.upstream ?? "—"}
                {row.upstream_tls && (
                  <span className="ml-1.5 rounded bg-slate-800 px-1 py-0.5 text-[10px] text-slate-400">
                    https
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                {!row.routed ? (
                  <Dash />
                ) : row.synced === null ? (
                  <StatusBadge status="unknown" label="unknown" />
                ) : row.synced ? (
                  <StatusBadge status="synced" label="synced" />
                ) : (
                  <StatusBadge status="unsynced" label="not pushed" />
                )}
              </td>
              <td className="px-4 py-3">
                {!row.routed || row.upstream_healthy === null ? (
                  <Dash />
                ) : row.upstream_healthy ? (
                  <StatusBadge status="healthy" label="up" />
                ) : (
                  <StatusBadge status="unreachable" label="down" />
                )}
              </td>
              <td className="px-4 py-3">
                {row.routed ? (
                  <DnsCell present={row.dnsPresent} conflict={row.dnsConflict} />
                ) : (
                  <Dash />
                )}
              </td>
              {hasActions && (
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {row.routed && onToggleRewrite && (
                      <RewriteAction row={row} busy={rewriteBusyId === row.id} onToggle={onToggleRewrite} />
                    )}
                    {row.routed && onTogglePrivate && (
                      <IconButton
                        busy={privateBusyId === row.id}
                        title={row.private ? "Private — hidden from dashboard" : "Public on dashboard"}
                        onClick={() => onTogglePrivate(row)}
                        icon={row.private ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      />
                    )}
                    {onAssign && (
                      <IconButton
                        busy={false}
                        title={row.routed ? "Change URL" : "Assign a URL"}
                        onClick={() => onAssign(row)}
                        icon={
                          row.routed ? (
                            <Pencil className="h-3.5 w-3.5" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )
                        }
                      />
                    )}
                    {row.routed && onRemoveRoute && (
                      <IconButton
                        busy={actionBusyId === row.id}
                        title="Remove route (keep the instance)"
                        onClick={() => onRemoveRoute(row)}
                        icon={<Unlink className="h-3.5 w-3.5" />}
                      />
                    )}
                    {onDelete && (
                      <IconButton
                        busy={actionBusyId === row.id}
                        disabled={row.type === "docker"}
                        title={
                          row.type === "docker"
                            ? "Container-backed instance — can't be deleted here. Remove its route instead, or delete the container in the Docker tab (its route is cleaned up automatically when the container is gone)."
                            : "Delete instance"
                        }
                        danger
                        onClick={() => onDelete(row)}
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                      />
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dash() {
  return <span className="text-xs text-slate-600">—</span>;
}

function DnsCell({ present, conflict }: { present?: boolean | null; conflict?: boolean }) {
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

function IconButton({
  busy,
  title,
  icon,
  onClick,
  danger = false,
  disabled = false,
}: {
  busy: boolean;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const base = `inline-flex items-center rounded-lg border border-slate-700 px-2 py-1 text-xs ${
    danger ? "text-rose-300" : "text-slate-300"
  }`;
  // Disabled action: render a non-interactive span (a `disabled` <button> suppresses the
  // hover tooltip in most browsers) so the explanatory title still shows on hover.
  if (disabled && !busy) {
    return (
      <span aria-disabled="true" title={title} className={`${base} cursor-not-allowed opacity-40`}>
        {icon}
      </span>
    );
  }
  return (
    <button
      disabled={busy}
      onClick={onClick}
      title={title}
      className={`${base} disabled:opacity-40 ${
        danger ? "hover:bg-rose-500/10" : "hover:bg-slate-800"
      }`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
    </button>
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
  const disabled = busy || row.dnsPresent === undefined || row.dnsPresent === null;
  const present = row.dnsPresent === true;
  return (
    <button
      disabled={disabled}
      onClick={() => onToggle(row)}
      title={present ? "Remove DNS rewrite" : "Add DNS rewrite"}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : present ? <Trash2 className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
      Rewrite
    </button>
  );
}
