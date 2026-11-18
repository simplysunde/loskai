import { Eye, EyeOff, HardDrive, ImagePlus, Link as LinkIcon, Pencil, Plus, Trash2, Unlink, X } from "lucide-react";

import { CARD_TABLE } from "../../lib/ui";
import { dnsFine } from "../../lib/routes";
import { Hint } from "../shared/Hint";
import { IconButton } from "../shared/IconButton";
import { RouteLink } from "../shared/RouteLink";
import { StatusBadge } from "../shared/StatusBadge";
import { isMachine, machineAt, machineLabel } from "./machine";

const MACHINE_HINT = "The machine at this address — the route moves with it";
const MACHINE_FOLLOWING = "The machine at this address — the route follows its container";

export interface Instance {
  id: string;
  name: string;
  type: "docker" | "external";
  kind: "service" | "machine";
  subdomain: string | null;
  // `direct`: a link — no subdomain, opened at its upstream (Phase 45).
  route_mode?: "proxy" | "dns_only" | "direct";
  fqdn: string | null;
  // Where it opens — a route's name, a link's address (the server's instances.open_url).
  url?: string | null;
  upstream: string | null;
  upstream_tls?: boolean;
  scheme?: "https" | "both" | "http";
  private: boolean;
  container?: string | null;
  origin?: string | null;
  // The upstream is the container's, kept in step when its port changes (Phase 29).
  follow_container?: boolean;
  icon?: string | null;
  routed: boolean;
  synced: boolean | null;
  // Merged in from /api/adguard/status (routed rows only):
  dnsPresent?: boolean | null;
  dnsConflict?: boolean;
}

// One row per instance (routed or not). Routed rows show route/DNS status, private, and
// "remove route". Unrouted rows offer "Change URL". Any instance can be deleted (docker
// included — the route + record go, the container is untouched and re-routable via Add
// route). Missing or stale DNS rewrites are fixed globally via the Sync button, not per row.
//
// A link (Phase 45) is a row with no route: it opens at its address, is edited as a link,
// and can be given an HTTPS name. Without Caddy (`caddySetUp` false) nothing offers a route, and
// an unrouted row offers a link instead.
export function ServiceTable({
  rows,
  machines = rows,
  onAssign,
  onRemoveRoute,
  onDelete,
  actionBusyId,
  onTogglePrivate,
  privateBusyId,
  onIcon,
  onClearIcon,
  onLink,
  caddySetUp = true,
}: {
  rows: Instance[];
  // Where a row's machine is looked up. Routing shows services only, so the machines its
  // routes are on are not among `rows`.
  machines?: Instance[];
  onAssign?: (row: Instance) => void;
  onRemoveRoute?: (row: Instance) => void;
  onDelete?: (row: Instance) => void;
  actionBusyId?: string | null;
  onTogglePrivate?: (row: Instance) => void;
  privateBusyId?: string | null;
  // Launcher icon: picking a file uploads it, and a row with one offers to clear it.
  onIcon?: (row: Instance, file: File) => void;
  onClearIcon?: (row: Instance) => void;
  // Edit a link, or make one of an unrouted row.
  onLink?: (row: Instance) => void;
  // Caddy is set up: routes can be made.
  caddySetUp?: boolean;
}) {
  const hasActions = Boolean(onAssign || onRemoveRoute || onDelete || onTogglePrivate);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 py-12 text-center text-sm text-slate-500">
        {caddySetUp
          ? "No services yet. Add route gives one a name."
          : "No services yet. Add a link to put one on the Dashboard."}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className={`w-full text-left text-sm ${CARD_TABLE}`}>
        <thead className="border-b border-slate-800 text-xs uppercase text-slate-500 max-sm:hidden">
          <tr>
            <th className="px-4 py-2.5 font-medium">Service</th>
            <th className="px-4 py-2.5 font-medium">Upstream</th>
            <th className="px-4 py-2.5 font-medium">
              <Hint text={ROUTE_HINT}>Route</Hint>
            </th>
            <th className="px-4 py-2.5 font-medium">
              <Hint text={DNS_HINT}>DNS</Hint>
            </th>
            {hasActions && <th className="px-4 py-2.5 font-medium text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {rows.map((row) => {
            const machine = machineAt(row.upstream, machines);
            const link = row.route_mode === "direct";
            return (
              <tr key={row.id} className="hover:bg-slate-900/40 max-sm:px-4 max-sm:py-3">
                <td className="px-4 py-3 max-sm:basis-full">
                  <div className="flex items-center gap-2 font-medium text-slate-100">
                    {onIcon && !isMachine(row) && (
                      <IconPicker row={row} onPick={onIcon} onClear={onClearIcon} />
                    )}
                    {row.name}
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {row.type}
                    </span>
                  </div>
                  <div className="mt-1 text-xs">
                    {row.url ? (
                      <RouteLink url={row.url} />
                    ) : (
                      <span className="text-slate-600">not routed</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400 max-sm:basis-full">
                  {/* The address on top, always: a machine's name is not one (a dotted
                      name like `adguard.lxc` would read as a hostname that does not
                      resolve). The machine at that address sits beneath. */}
                  {row.upstream ?? "—"}
                  {/* Only when it differs from the default: a tag on every row would be
                      noise, and https is what almost everything should be. */}
                  {row.scheme && row.scheme !== "https" && (
                    <span className="ml-1.5 rounded bg-amber-500/10 px-1 py-0.5 text-[10px] text-amber-300">
                      <Hint
                        text={
                          row.scheme === "http"
                            ? "Plain HTTP only — no certificate is issued for this name"
                            : "Served on both 443 and 80"
                        }
                      >
                        {row.scheme}
                      </Hint>
                    </span>
                  )}
                  {row.upstream_tls && (
                    <span className="ml-1.5 rounded bg-slate-800 px-1 py-0.5 text-[10px] text-slate-400">
                      https
                    </span>
                  )}
                  {link && (
                    <span className="ml-1.5 rounded bg-slate-800 px-1 py-0.5 text-[10px] text-slate-400">
                      <Hint text="A link: the Dashboard opens this address directly — no name, no Caddy route">
                        link
                      </Hint>
                    </span>
                  )}
                  {machine && (
                    <div className="flex w-fit items-center gap-1 text-[11px] text-slate-500">
                      <HardDrive className="h-3 w-3" />
                      <Hint text={row.follow_container ? MACHINE_FOLLOWING : MACHINE_HINT}>
                        {machineLabel(machine)}
                      </Hint>
                    </div>
                  )}
                </td>
                {/* A phone has no column headings: it shows these two only when something
                    is wrong, and says which. */}
                <td className={`px-4 py-3 ${routeFine(row) ? "max-sm:hidden" : ""}`}>
                  {!row.routed ? (
                    <Dash />
                  ) : row.synced === null ? (
                    <StatusBadge status="unknown" label={<><OnPhone>route</OnPhone>unknown</>} />
                  ) : row.synced ? (
                    <StatusBadge status="synced" label="synced" />
                  ) : (
                    <StatusBadge status="unsynced" label={<><OnPhone>route</OnPhone>not pushed</>} />
                  )}
                </td>
                <td className={`px-4 py-3 ${!row.routed || dnsFine(row) ? "max-sm:hidden" : ""}`}>
                  {row.routed ? (
                    <DnsCell present={row.dnsPresent} conflict={row.dnsConflict} />
                  ) : (
                    <Dash />
                  )}
                </td>
                {hasActions && (
                  <td className="px-4 py-3 max-sm:ml-auto">
                    <div className="flex items-center justify-end gap-1.5">
                      {(row.routed || link) && onTogglePrivate && (
                        <IconButton
                          busy={privateBusyId === row.id}
                          title={row.private ? "Private — hidden from dashboard" : "Public on dashboard"}
                          onClick={() => onTogglePrivate(row)}
                        >
                          {row.private ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </IconButton>
                      )}
                      {link && onLink && (
                        <IconButton title="Edit link" onClick={() => onLink(row)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                      {onAssign && caddySetUp && (
                        <IconButton
                          title={assignLabel(row)}
                          onClick={() => onAssign(row)}
                        >
                          {row.routed ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        </IconButton>
                      )}
                      {/* A row with no route — never routed, or its route removed — becomes a
                          link on the same record, with Caddy set up or not. */}
                      {!row.routed && !link && onLink && (
                        <IconButton title="Make a link" onClick={() => onLink(row)}>
                          <LinkIcon className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                      {row.routed && onRemoveRoute && (
                        <IconButton
                          busy={actionBusyId === row.id}
                          title="Remove route (keep the instance)"
                          onClick={() => onRemoveRoute(row)}
                        >
                          <Unlink className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                      {onDelete && (
                        <IconButton
                          busy={actionBusyId === row.id}
                          title="Delete instance"
                          tone="danger"
                          onClick={() => onDelete(row)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Header tooltips: what each status column checks. Both are re-read every 15 seconds.
const ROUTE_HINT = "Is the route loaded in Caddy? \"not pushed\" = Loskai has it but Caddy doesn't; Sync fixes it.";
export const DNS_HINT = "Does AdGuard answer this name with the right address? \"conflict\" = another answer exists for it too.";

function Dash() {
  return <span className="text-xs text-slate-600">—</span>;
}

function routeFine(row: Instance) {
  return !row.routed || row.synced === true;
}
function OnPhone({ children }: { children: string }) {
  return <span className="sm:hidden">{children} </span>;
}

// `beside` a name, with no DNS column over it: each badge says DNS, and while it is set there
// is none — only what is wrong shows.
export function DnsCell({
  present,
  conflict,
  beside = false,
}: {
  present?: boolean | null;
  conflict?: boolean;
  beside?: boolean;
}) {
  const dns = beside ? "DNS " : <OnPhone>DNS</OnPhone>;
  return (
    <div className="flex items-center gap-1.5">
      {present === undefined || present === null ? (
        <StatusBadge status="unknown" label={<>{dns}unknown</>} />
      ) : present ? (
        !beside && <StatusBadge status="synced" label="set" />
      ) : (
        <StatusBadge status="unsynced" label={<>{dns}missing</>} />
      )}
      {conflict && <StatusBadge status="degraded" label={<>{dns}conflict</>} />}
    </div>
  );
}

// What the route action on a row is called — its button's hint, and the title of the dialog
// it opens: editing a route, naming a row that has none, or giving a link a name.
export function assignLabel(row: Instance | null): string {
  if (!row) return "Assign a URL";
  return row.routed ? "Change URL" : row.route_mode === "direct" ? "Give it an HTTPS name" : "Assign a URL";
}

// The launcher icon, edited where the service is named rather than behind a dialog: the
// thumbnail *is* the control. Machines have no card, so they have no icon to set.
function IconPicker({
  row,
  onPick,
  onClear,
}: {
  row: Instance;
  onPick: (row: Instance, file: File) => void;
  onClear?: (row: Instance) => void;
}) {
  const id = `icon-${row.id}`;
  return (
    <span className="group relative inline-flex">
      <label
        htmlFor={id}
        title={row.icon ? "Change the launcher icon" : "Set a launcher icon (PNG, JPEG or WebP)"}
        className="flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded border border-slate-800 bg-slate-900 text-slate-600 hover:border-teal-600/50 hover:text-teal-300"
      >
        {row.icon ? (
          <img src={row.icon} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus className="h-3.5 w-3.5" />
        )}
      </label>
      <input
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(row, file);
          e.target.value = ""; // so re-picking the same file fires again
        }}
      />
      {row.icon && onClear && (
        <button
          onClick={() => onClear(row)}
          title="Remove the launcher icon"
          className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-slate-800 p-0.5 text-slate-400 hover:text-rose-300 group-hover:block"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}
