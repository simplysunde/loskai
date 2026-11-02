import { Fragment } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CornerDownRight,
  HardDrive,
  Loader2,
  Plus,
  Settings,
  Terminal,
  Trash2,
} from "lucide-react";

import { RouteLink } from "../shared/RouteLink";
import type { Running, SshHost } from "../../lib/ssh";
import type { Tool } from "../../lib/tools";
import { useExpanded } from "../../lib/useExpanded";
import { splitUpstream } from "../../lib/validation";
import { routesOn } from "./machine";
import { ToolsMenu } from "./MachineTools";
import { RunningPill } from "./RunningPill";
import { DNS_HINT, DnsCell, type RouteRow } from "./ServiceTable";

// Each machine, with the routes on its address beneath it — the reason a machine is named
// at all. Like a stack on the Docker tab, a machine's row opens to show them. A route lists
// only its port here: the host half is the machine above it.
export function MachineTable({
  machines,
  rows,
  ssh = {},
  trusted = {},
  running = {},
  onOpen,
  onDelete,
  onAddRoute,
  onTerminal,
  tools,
  onTool,
  busyId,
}: {
  machines: RouteRow[];
  // Every row, for the dependents — they are services, so not among `machines`.
  rows: RouteRow[];
  // SSH config entries by alias; a machine's is named after its hostname.
  ssh?: Record<string, SshHost>;
  // Machine ids with a trusted host key, and what runs on each of those, by id.
  trusted?: Record<string, boolean>;
  running?: Record<string, Running>;
  // The machine's own page — the cog. Once its SSH is set up, a terminal on it too.
  onOpen: (machine: RouteRow) => void;
  onTerminal?: (machine: RouteRow) => void;
  onDelete: (machine: RouteRow) => void;
  // Add route, already on this machine's address — the usual reason to have named it.
  onAddRoute?: (machine: RouteRow) => void;
  // The tools in the image: a set-up machine's row opens each added one in a dialog.
  tools?: Tool[];
  onTool?: (machine: RouteRow, toolId: string) => void;
  busyId?: string | null;
}) {
  const expanded = useExpanded("loskai.machines.expanded");

  if (machines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 py-12 text-center text-sm text-slate-500">
        No machines yet. Name one — a NAS, a hypervisor, a VM — and routes can point at it
        by name.
      </div>
    );
  }

  const ids = machines.map((m) => m.id);
  const anyOpen = expanded.anyOpen(ids);
  const AllIcon = anyOpen ? ChevronsDownUp : ChevronsUpDown;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">
              <div className="flex items-center gap-1.5">
                Machine
                <button
                  onClick={() => expanded.toggleAll(ids)}
                  title={anyOpen ? "Collapse all" : "Expand all"}
                  aria-label={`${anyOpen ? "Collapse" : "Expand"} all machines`}
                  className="rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                >
                  <AllIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </th>
            <th className="px-4 py-2.5 font-medium">URL</th>
            <th className="px-4 py-2.5 font-medium">Address</th>
            <th className="px-4 py-2.5 font-medium">Running</th>
            <th title={DNS_HINT} className="cursor-help px-4 py-2.5 font-medium">DNS</th>
            <th className="px-4 py-2.5 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {[...machines]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((m) => {
              const deps = routesOn(m, rows);
              const host = m.subdomain ? ssh[m.subdomain] : undefined;
              const sshReady = Boolean(host?.user);
              const open = expanded.isOpen(m.id);
              const Chevron = open ? ChevronDown : ChevronRight;
              return (
                <Fragment key={m.id}>
                  <tr className="border-t border-slate-800 bg-slate-900/50">
                    <td className="px-4 py-2">
                      <button
                        onClick={() => expanded.toggle(m.id)}
                        aria-expanded={open}
                        title={`${deps.length} ${deps.length === 1 ? "route" : "routes"} on this machine`}
                        className="flex items-center gap-2 text-left"
                      >
                        <Chevron className="h-4 w-4 text-slate-500" />
                        <HardDrive className="h-3.5 w-3.5 text-teal-300/70" />
                        <span className="font-medium text-slate-100">{m.name}</span>
                        {/* Collapsed, the row still says how many it holds. */}
                        {!open && deps.length > 0 && (
                          <span className="text-xs text-slate-500">{deps.length}</span>
                        )}
                      </button>
                    </td>
                    {/* Plain text, not a link: a machine's name is DNS only, so nothing
                        is promised to answer on it over https. */}
                    <td className="px-4 py-2 text-xs text-slate-400">{m.fqdn ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-300">{m.upstream ?? "—"}</td>
                    <td className="px-4 py-2">
                      {running[m.id] ? (
                        <RunningPill running={running[m.id]} user={host?.user} />
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <DnsCell present={m.dnsPresent} conflict={m.dnsConflict} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        {sshReady && m.subdomain && host && trusted[m.id] && onTerminal && (
                          <IconButton title={`Terminal: ${sshTitle(m.subdomain, host)}`} onClick={() => onTerminal(m)}>
                            <Terminal className="h-3.5 w-3.5" />
                          </IconButton>
                        )}
                        {sshReady && trusted[m.id] && tools && onTool && (
                          <ToolsMenu
                            machineId={m.id}
                            tools={tools}
                            className={ICON_BUTTON}
                            onPick={(toolId) => onTool(m, toolId)}
                          />
                        )}
                        {onAddRoute && (
                          <IconButton title="Add a route on this machine" onClick={() => onAddRoute(m)}>
                            <Plus className="h-3.5 w-3.5" />
                          </IconButton>
                        )}
                        {/* Its dialog: name, address, SSH, what runs there. Amber while it has
                            an SSH user but isn't set up yet. */}
                        <IconButton
                          title={sshReady && !trusted[m.id] ? "Machine settings — SSH not set up yet" : "Machine settings"}
                          warn={sshReady && !trusted[m.id]}
                          onClick={() => onOpen(m)}
                        >
                          <Settings className="h-3.5 w-3.5" />
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
                  {open && deps.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 pb-2 pl-11 text-xs text-slate-600">
                        No routes on this machine.
                      </td>
                    </tr>
                  )}
                  {open &&
                    deps.map((d) => (
                      <tr key={d.id} className="text-xs hover:bg-slate-900/40">
                        <td className="py-1 pl-10 pr-4">
                          <div className="flex items-center gap-1.5 text-slate-300">
                            <CornerDownRight className="h-3.5 w-3.5 text-slate-600" />
                            {d.name}
                          </div>
                        </td>
                        <td className="px-4 py-1">
                          {d.fqdn ? (
                            <RouteLink host={d.fqdn} scheme={d.scheme} />
                          ) : (
                            <span className="text-slate-600">not routed</span>
                          )}
                        </td>
                        <td className="px-4 py-1 font-mono text-slate-500">
                          :{splitUpstream(d.upstream ?? "").port || "—"}
                        </td>
                        {/* No DNS state here: a route's own is the Routing tab's to show. These
                            rows say what the machine hosts; its DNS is the row above. */}
                        <td colSpan={3} />
                      </tr>
                    ))}
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
  warn = false,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  warn?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`${ICON_BUTTON_SHAPE} ${
        danger
          ? "text-rose-300 hover:bg-rose-500/10"
          : warn
            ? "text-amber-300 hover:bg-amber-500/10"
            : "text-slate-300 hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

const ICON_BUTTON_SHAPE = "inline-flex items-center rounded-lg border border-slate-700 px-2 py-1 text-xs";
const ICON_BUTTON = `${ICON_BUTTON_SHAPE} text-slate-300 hover:bg-slate-800`;

function sshTitle(alias: string, host: SshHost): string {
  return `ssh ${alias} — ${host.user ?? "?"}@${host.hostname ?? alias}, port ${host.port}`;
}
