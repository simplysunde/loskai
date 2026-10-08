import { Fragment } from "react";
import { CornerDownRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { RouteLink } from "../shared/RouteLink";
import { splitUpstream } from "../../lib/validation";
import { dependentsOf, onAddressOf } from "./machine";
import { MachineLinkIcon } from "./MachineLinkIcon";
import { DNS_HINT, DnsCell, type RouteRow } from "./ServiceTable";

// Each machine, with the routes hosted on it listed directly beneath — the dependency the
// `machine` link records, which is the reason a machine is named at all — then the unlinked
// ones that merely share its address; an icon says which, since those will not follow it. A route lists
// only its port here: the host half is the machine above it.
export function MachineTable({
  machines,
  rows,
  onEdit,
  onDelete,
  onAddRoute,
  busyId,
}: {
  machines: RouteRow[];
  // Every row, for the dependents — they are services, so not among `machines`.
  rows: RouteRow[];
  onEdit: (machine: RouteRow) => void;
  onDelete: (machine: RouteRow) => void;
  // Add route, already linked to this machine — the usual reason to have named it.
  onAddRoute?: (machine: RouteRow) => void;
  busyId?: string | null;
}) {
  if (machines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 py-12 text-center text-sm text-slate-500">
        No machines yet. Name one — a NAS, a hypervisor, a VM — and routes can point at it
        by name.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">Machine</th>
            <th className="px-4 py-2.5 font-medium">Address</th>
            <th title={DNS_HINT} className="cursor-help px-4 py-2.5 font-medium">DNS</th>
            <th className="px-4 py-2.5 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {[...machines]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((m) => {
              const deps = [
                ...dependentsOf(m.id, rows).map((d) => ({ d, linked: true })),
                ...onAddressOf(m, rows).map((d) => ({ d, linked: false })),
              ];
              return (
                <Fragment key={m.id}>
                  <tr className="border-t border-slate-800/70 hover:bg-slate-900/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-100">{m.name}</div>
                      <div className="text-xs text-slate-500">{m.fqdn}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{m.upstream ?? "—"}</td>
                    <td className="px-4 py-3">
                      <DnsCell present={m.dnsPresent} conflict={m.dnsConflict} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {onAddRoute && (
                          <IconButton title="Add a route on this machine" onClick={() => onAddRoute(m)}>
                            <Plus className="h-3.5 w-3.5" />
                          </IconButton>
                        )}
                        <IconButton title="Edit machine" onClick={() => onEdit(m)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton title="Delete machine" danger onClick={() => onDelete(m)}>
                          {busyId === m.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                  {deps.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 pb-3 pl-10 text-xs text-slate-600">
                        No routes on this machine.
                      </td>
                    </tr>
                  ) : (
                    deps.map(({ d, linked }) => (
                      <tr key={d.id} className="text-xs hover:bg-slate-900/40">
                        <td className="py-1.5 pl-6 pr-4">
                          <div className="flex items-center gap-1.5 text-slate-300">
                            <CornerDownRight className="h-3.5 w-3.5 text-slate-600" />
                            {d.name}
                            <MachineLinkIcon auto={!linked} />
                          </div>
                          <div className="mt-1 pl-5">
                            {d.fqdn ? (
                              <RouteLink host={d.fqdn} scheme={d.scheme} />
                            ) : (
                              <span className="text-slate-600">not routed</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-1.5 font-mono text-slate-500">
                          :{splitUpstream(d.upstream ?? "").port || "—"}
                        </td>
                        <td className="px-4 py-1.5" colSpan={2}>
                          {d.routed && <DnsCell present={d.dnsPresent} conflict={d.dnsConflict} />}
                        </td>
                      </tr>
                    ))
                  )}
                </Fragment>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

function IconButton({
  title,
  onClick,
  children,
  danger = false,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`inline-flex items-center rounded-lg border border-slate-700 px-2 py-1 text-xs ${
        danger ? "text-rose-300 hover:bg-rose-500/10" : "text-slate-300 hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}
