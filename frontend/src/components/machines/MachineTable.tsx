import { Fragment } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CornerDownRight,
  Download,
  HardDrive,
  Loader2,
  MoreVertical,
  Plus,
  Route as RouteIcon,
  Settings,
  Tag,
  Terminal,
  Trash2,
} from "lucide-react";

import { CARD_TABLE } from "../../lib/ui";
import { dnsFine } from "../../lib/routes";
import { ICON_BUTTON, IconButton } from "../shared/IconButton";
import { RouteLink } from "../shared/RouteLink";
import { RowMenu, type RowMenuItem } from "../shared/RowMenu";
import type { Running, SshHost } from "../../lib/ssh";
import type { Tool, TargetKind } from "../../lib/tools";
import { useExpanded } from "../../lib/useExpanded";
import { useCaddySetUp } from "../../lib/useHealth";
import { splitUpstream } from "../../lib/validation";
import { DOCKER_HOST_ID, routesOn } from "../routing/machine";
import { RowTools } from "./MachineTools";
import { guestAddress, guestHostname, guestMachine, servicesOn, type MachineService } from "../routing/machineServices";
import { RunningPill, type PortAction } from "./RunningPill";
import { CopyButton } from "../shared/CopyButton";
import { DNS_HINT, DnsCell, type Instance } from "../routing/ServiceTable";
import { Hint } from "../shared/Hint";

// A small copy button after a name or an address: shown on the row's hover (or focus) —
// always on a phone, which has no hover.
const COPY =
  "rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 [&_svg]:h-3 [&_svg]:w-3";

const URL_HINT = "Its name on your network. Beside it, only when wrong: whether AdGuard answers it with its address.";

// Each machine, with the routes on its address beneath it — the reason a machine is named
// at all. Like a stack on the Docker tab, a machine's row opens to show them. A route lists
// only its port here: the host half is the machine above it. The Docker host — named or not —
// comes first, tinted, since Loskai itself runs there.
export function MachineTable({
  machines,
  rows,
  sshHosts = {},
  targets = {},
  trusted = {},
  running = {},
  onOpen,
  onDelete,
  onAddRoute,
  onRouteService,
  onName,
  onNameGuest,
  dockerHost,
  onTerminal,
  onUpdate,
  tools,
  onTool,
  busyId,
}: {
  machines: Instance[];
  // Every row, for the dependents — they are services, so not among `machines`.
  rows: Instance[];
  // SSH config entries by alias; a machine's is named after its hostname.
  sshHosts?: Record<string, SshHost>;
  // How the server reaches each machine with an SSH user, by id ("user@host[:port]").
  targets?: Record<string, string>;
  // Machine ids with a trusted host key, and what runs on each of those, by id.
  trusted?: Record<string, boolean>;
  running?: Record<string, Running>;
  // The machine's own page — the cog. Once its SSH is set up, a terminal on it too.
  onOpen: (machine: Instance) => void;
  onTerminal?: (machine: Instance) => void;
  // System's Update, run in its terminal — given only where there is one.
  onUpdate?: (machine: Instance) => void;
  // Behind the row's ⋮, so it isn't one click from the buttons used every day.
  onDelete: (machine: Instance) => void;
  // Add route, already on this machine's address — the usual reason to have named it.
  onAddRoute?: (machine: Instance) => void;
  // A port on its running list: Add route there, with it picked.
  onRouteService?: (machine: Instance, service: MachineService) => void;
  // The Docker host before it is named (`DOCKER_HOST_ID`): naming it is all its row offers,
  // beside Add route — no SSH, DNS or settings until it is a machine.
  onName?: (machine: Instance) => void;
  // A Proxmox guest on its running list: Name a machine, with its name and address.
  onNameGuest?: (guest: { name: string; address: string; unknown?: string }) => void;
  // The Docker host's address: its containers are the Container source, not buttons here.
  dockerHost?: string | null;
  // The tools in the image: a set-up machine's row opens each added one in a dialog.
  tools?: Tool[];
  onTool?: (machine: Instance, toolId: string) => void;
  busyId?: string | null;
}) {
  const expanded = useExpanded("loskai.machines.expanded");
  const caddySetUp = useCaddySetUp();

  if (machines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 py-12 text-center text-sm text-slate-500">
        No machines yet. Name one — a NAS, a hypervisor, a VM — and routes can point at it
        by name.
      </div>
    );
  }

  // The button on a guest's row of a machine's running list: naming it (or the machine it
  // already is).
  const runningActions = (machine: Instance) => {
    const r = running[machine.id];
    return (target: TargetKind, id: string): React.ReactNode => {
      if (target === "lxc" || target === "vm") {
        const guest = r?.guests?.find((g) => g.id === id);
        if (!guest || !onNameGuest) return null;
        const named = guestMachine(guest, rows);
        if (named) return <span className="truncate text-[11px] text-slate-400">{named.fqdn ?? named.name}</span>;
        const address = guestAddress(guest, machine.upstream);
        return (
          <button
            title={address ? `Name it as a machine, at ${address}` : "Name it as a machine — its address isn't known (a VM without the QEMU guest agent)"}
            onClick={() =>
              onNameGuest({
                name: guestHostname(guest.name),
                address,
                unknown: address ? undefined : UNKNOWN_ADDRESS[guest.kind],
              })
            }
            className={RUNNING_BUTTON}
          >
            <HardDrive className="h-3 w-3" />
            Name
          </button>
        );
      }
      return null;
    };
  };

  // The right half of a port's chip on the running list: a route to it — a link while Caddy
  // isn't set up — or the route or link it has.
  const portAction = (machine: Instance): PortAction => {
    const services = servicesOn(machine, running[machine.id], rows, dockerHost);
    return (kind, name, port) => {
      const s = services.find((x) => x.kind === kind && x.name === name && x.upstream === `${machine.upstream}:${port}`);
      if (!s || !onRouteService) return null;
      // The route's icon, opening it; its name on hover — the chip has no room for it.
      if (s.route?.url) {
        const name = s.route.url.replace(/^https?:\/\//, "");
        return (
          <a
            href={s.route.url}
            target="_blank"
            rel="noreferrer"
            title={name}
            aria-label={name}
            className="flex h-full items-center rounded-r-md px-1.5 text-teal-300 hover:bg-teal-500/15"
          >
            <RouteIcon className="h-3 w-3" />
          </a>
        );
      }
      const what = `${caddySetUp ? "Add a route" : "Add a link"} to ${s.upstream}`;
      return (
        <button
          title={what}
          aria-label={what}
          onClick={() => onRouteService(machine, s)}
          className="flex h-full items-center rounded-r-md px-1.5 text-slate-200 hover:bg-slate-800"
        >
          <Plus className="h-3 w-3" />
        </button>
      );
    };
  };

  const isHost = (m: Instance) => Boolean(dockerHost) && m.upstream === dockerHost;
  const ids = machines.map((m) => m.id);
  const anyOpen = expanded.anyOpen(ids);
  const AllIcon = anyOpen ? ChevronsDownUp : ChevronsUpDown;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className={`w-full text-left text-sm ${CARD_TABLE}`}>
        {/* On a phone only its first cell, for Expand all. */}
        <thead className="border-b border-slate-800 text-xs uppercase text-slate-500 max-sm:block">
          <tr className="max-sm:px-4 max-sm:py-2.5">
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
            <th className="px-4 py-2.5 font-medium max-sm:hidden">
              <Hint text={URL_HINT}>URL</Hint>
            </th>
            <th className="px-4 py-2.5 font-medium max-sm:hidden">Address</th>
            <th className="px-4 py-2.5 font-medium max-sm:hidden">Running</th>
            <th className="px-4 py-2.5 font-medium text-right max-sm:hidden">Actions</th>
          </tr>
        </thead>
        <tbody>
          {[...machines]
            .sort((a, b) => Number(isHost(b)) - Number(isHost(a)) || a.name.localeCompare(b.name))
            .map((machine) => {
              const routes = routesOn(machine, rows);
              const unnamed = machine.id === DOCKER_HOST_ID;
              const atHost = isHost(machine);
              const sshEntry = machine.subdomain ? sshHosts[machine.subdomain] : undefined;
              const hasSshLogin = Boolean(sshEntry?.user);
              const open = expanded.isOpen(machine.id);
              const Chevron = open ? ChevronDown : ChevronRight;
              const menu: RowMenuItem[] = [
                ...(onAddRoute ? [{ label: "Add a route", icon: <RouteIcon className="h-3.5 w-3.5" />, onClick: () => onAddRoute(machine) }] : []),
                ...(hasSshLogin && trusted[machine.id] && onUpdate
                  ? [{
                      label: "Update system",
                      title: "Refresh the package lists, then install every update — in its terminal",
                      icon: <Download className="h-3.5 w-3.5" />,
                      onClick: () => onUpdate(machine),
                    }]
                  : []),
                ...(unnamed ? [] : [{ label: "Delete machine", icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, onClick: () => onDelete(machine) }]),
              ];
              return (
                <Fragment key={machine.id}>
                  <tr className={`group border-t border-slate-800 max-sm:px-4 max-sm:py-2.5 ${atHost ? "bg-teal-500/5" : "bg-slate-900/50"}`}>
                    <td className="px-4 py-2 max-sm:basis-full">
                      <button
                        onClick={() => expanded.toggle(machine.id)}
                        aria-expanded={open}
                        title={`${routes.length} ${routes.length === 1 ? "route" : "routes"} on this machine`}
                        className="flex items-center gap-2 text-left"
                      >
                        <Chevron className="h-4 w-4 text-slate-500" />
                        <HardDrive className={`h-3.5 w-3.5 ${atHost ? "text-teal-300" : "text-teal-300/70"}`} />
                        <span className="font-medium text-slate-100">{machine.name}</span>
                        {unnamed && <span className="text-xs text-slate-500">not named</span>}
                        {atHost && !unnamed && (
                          <span
                            title="Where Loskai runs — the Docker Host LAN IP in Settings › General"
                            className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-300"
                          >
                            Host
                          </span>
                        )}
                        {/* Collapsed, the row still says how many it holds. */}
                        {!open && routes.length > 0 && (
                          <span className="text-xs text-slate-500">{routes.length}</span>
                        )}
                      </button>
                    </td>
                    {/* Plain text, not a link: a machine's name is DNS only, so nothing
                        is promised to answer on it over https. Its DNS state beside it, only
                        while AdGuard doesn't answer it right. A phone, with no column
                        headings, leaves out the empty cells. */}
                    <td className={`px-4 py-2 text-xs text-slate-400 ${machine.fqdn ? "" : "max-sm:hidden"}`}>
                      {machine.fqdn ? (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="flex items-center gap-1">
                            <Hint text={dnsFine(machine) ? `AdGuard answers it with ${machine.upstream}` : DNS_HINT}>
                              {machine.fqdn}
                            </Hint>
                            <CopyButton text={machine.fqdn} title={`Copy ${machine.fqdn}`} className={COPY} />
                          </span>
                          {!dnsFine(machine) && <DnsCell present={machine.dnsPresent} conflict={machine.dnsConflict} beside />}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-300">
                      {machine.upstream ? (
                        <span className="flex items-center gap-1">
                          {machine.upstream}
                          <CopyButton text={machine.upstream} title={`Copy ${machine.upstream}`} className={COPY} />
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`px-4 py-2 ${running[machine.id] ? "" : "max-sm:hidden"}`}>
                      {running[machine.id] ? (
                        <RunningPill running={running[machine.id]} user={sshEntry?.user} address={machine.upstream} actions={runningActions(machine)} portAction={portAction(machine)} />
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 max-sm:ml-auto">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {hasSshLogin && trusted[machine.id] && tools && onTool && (
                          <RowTools
                            machineId={machine.id}
                            tools={tools}
                            onPick={(toolId) => onTool(machine, toolId)}
                          />
                        )}
                        {unnamed && onName && (
                          <IconButton title="Name it — a DNS name, then SSH and its tools" onClick={() => onName(machine)}>
                            <Tag className="h-3.5 w-3.5" />
                          </IconButton>
                        )}
                        {/* What every row has comes last, so it sits in the same place on each:
                            the tools a machine has go to its left. */}
                        {hasSshLogin && machine.subdomain && targets[machine.id] && trusted[machine.id] && onTerminal && (
                          <IconButton title={`Terminal: ssh ${machine.subdomain} — ${targets[machine.id]}`} onClick={() => onTerminal(machine)}>
                            <Terminal className="h-3.5 w-3.5" />
                          </IconButton>
                        )}
                        {/* Its dialog: name, address, SSH, what runs there. Amber while it has
                            an SSH user but isn't set up yet. */}
                        {!unnamed && <IconButton
                          title={hasSshLogin && !trusted[machine.id] ? "Machine settings — SSH not set up yet" : "Machine settings"}
                          tone={hasSshLogin && !trusted[machine.id] ? "warn" : "plain"}
                          onClick={() => onOpen(machine)}
                        >
                          <Settings className="h-3.5 w-3.5" />
                        </IconButton>}
                        {/* What a row does less often: a route on its address, its system's
                            update, and — once named — deleting it. */}
                        {menu.length > 0 && <RowMenu
                          label="More"
                          trigger={
                            busyId === machine.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <MoreVertical className="h-3.5 w-3.5" />
                            )
                          }
                          triggerClass={ICON_BUTTON}
                          items={menu}
                        />}
                      </div>
                    </td>
                  </tr>
                  {open && routes.length === 0 && (
                    <tr className="max-sm:pb-2 max-sm:pl-11">
                      <td colSpan={5} className="px-4 pb-2 pl-11 text-xs text-slate-600">
                        No routes on this machine.
                      </td>
                    </tr>
                  )}
                  {open &&
                    routes.map((route) => (
                      <tr key={route.id} className="text-xs hover:bg-slate-900/40 max-sm:py-1 max-sm:pl-10 max-sm:pr-4">
                        <td className="py-1 pl-10 pr-4">
                          <div className="flex items-center gap-1.5 text-slate-300">
                            <CornerDownRight className="h-3.5 w-3.5 text-slate-600" />
                            {route.name}
                          </div>
                        </td>
                        <td className="px-4 py-1">
                          {route.url ? (
                            <RouteLink url={route.url} />
                          ) : (
                            <span className="text-slate-600">not routed</span>
                          )}
                        </td>
                        <td className="px-4 py-1 font-mono text-slate-500">
                          :{splitUpstream(route.upstream ?? "").port || "—"}
                        </td>
                        {/* No DNS state here: a route's own is the Routing tab's to show. These
                            rows say what the machine hosts; its DNS is the row above. */}
                        <td colSpan={2} className="max-sm:hidden" />
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



// Why a guest's address couldn't be read: a VM's comes from its QEMU guest agent, an LXC's
// from lxc-info, which needs root on the Proxmox host.
const UNKNOWN_ADDRESS = {
  vm: "Loskai couldn't read its address — a VM needs the QEMU guest agent.",
  lxc: "Loskai couldn't read its address — that needs root on the Proxmox host.",
};

const RUNNING_BUTTON =
  "flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800";
