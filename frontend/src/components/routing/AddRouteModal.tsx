import { useState } from "react";
import { Container as ContainerIcon, Server } from "lucide-react";
import { Link } from "react-router-dom";

import { useContainers, type Container } from "../../lib/containers";
import { useRoutes } from "../../lib/routes";
import { useSettings } from "../../lib/settings";
import { useRunning } from "../../lib/ssh";
import { useMe } from "../../lib/useAuth";
import { containerLabel, containerPrefill } from "./containerPrefill";
import { hostOptions } from "./hostOptions";
import { machineLabel } from "./machine";
import { machineServices, type MachineService } from "./machineServices";
import { SchemeSelect, type Scheme } from "./SchemeSelect";
import { RouteFields, RouteFormFooter } from "./RouteFields";
import { useRouteFields } from "./useRouteFields";
import { Overlay } from "../shared/Modal";

// The route payload the parent posts to /api/routes.
export interface NewRoute {
  prefix: string;
  upstream: string;
  upstream_tls: boolean;
  scheme?: Scheme;
  container?: string;
  origin?: string;
  name?: string;
  follow_container?: boolean;
}

export type Source = "container" | "machines";

// "Add route" picker: pick an unrouted Container or something running on a Machine, which
// pre-fills the prefix + upstream, or type any address into the fields — they stay
// editable, and Clear drops a pick. The tabs only choose which list shows. What already has
// a route is left out (it's managed as a row). This is the single route-creation surface —
// the Docker tab no longer assigns.
export function AddRouteModal({
  open,
  baseDomain,
  mode,
  initialMachine,
  pending = false,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  baseDomain: string | null;
  mode: "docker" | "lan" | null;
  // Opened from a machine's row on the Machines tab: what runs there, with its address in
  // the host field. The address is what puts the route on it.
  initialMachine?: { id: string; address: string };
  pending?: boolean;
  error?: string | null;
  onSubmit: (route: NewRoute) => void;
  onClose: () => void;
}) {
  // Only an account that may use the Machines tab may read what runs on them.
  const mayMachines = useMe().may("machines");
  const running = useRunning(open && mayMachines);
  // A machine's row is on the Machines tab, so whoever opened it from there may read it.
  const [source, setSource] = useState<Source>(initialMachine ? "machines" : "container");
  const [link, setLink] = useState<{ container?: string; name?: string }>({});
  const [picked, setPicked] = useState<string | null>(null);
  // A picked container's route follows it by default whenever its address can be derived.
  const [follow, setFollow] = useState(false);
  const [derived, setDerived] = useState<string | null>(null);
  const [scheme, setScheme] = useState<Scheme>("https");
  // A picked container answers the hint for itself; `mode` is the deployment-wide
  // fallback, for a machine's service or a typed address, which have no container.
  const [pickedMode, setPickedMode] = useState<"docker" | "lan" | null>(null);
  // Opened from a machine, an address typed by hand starts on it; only the port is left.
  const machineUpstream = initialMachine ? `${initialMachine.address}:` : "";
  const fields = useRouteFields({ mode: pickedMode ?? mode, baseDomain, initialUpstream: machineUpstream });

  const containers = useContainers({ enabled: open });
  // The rows the Routing page already fetched — no extra endpoint — for the host dropdown's
  // machines. Unlike the Container and Machines sources these are NOT filtered by whether
  // they are routed: you are borrowing the address, not routing the thing, so a NAS that
  // already answers to its own name is still a valid upstream for a new route.
  const rows = useRoutes(open);
  const settings = useSettings(open);


  if (!open) return null;

  const unroutedContainers = (containers.data ?? []).filter((c) => !c.subdomain);
  const pickedContainer = link.container ? (containers.data ?? []).find((c) => c.id === picked) : undefined;
  const hosts = hostOptions({
    rows: rows.data,
    dockerHost: settings.data?.host_ip?.value,
    containerHost: pickedContainer?.suggested_host,
  });
  const groups = machineServices(rows.data ?? [], running.data, settings.data?.host_ip?.value).filter(
    (g) => !initialMachine || g.machine.id === initialMachine.id,
  );

  // Forget a pick, keeping the fields.
  const drop = () => {
    setLink({});
    setPicked(null);
    setPickedMode(null);
    setFollow(false);
    setDerived(null);
  };
  const clear = () => {
    fields.set({ prefix: "", upstream: machineUpstream, tls: false });
    drop();
  };
  // A pick belongs to its list: showing the other one clears it, so a container's link
  // can't ride along with an address typed there. What was typed by hand stays.
  const showList = (next: Source) => {
    if (next === source) return;
    if (picked) clear();
    setSource(next);
  };

  const pickContainer = (c: Container) => {
    setPickedMode(c.upstream_mode ?? null);
    fields.set(containerPrefill(c, containers.data));
    setDerived(c.suggested_upstream ?? null);
    setFollow(Boolean(c.suggested_upstream));
    setLink({ container: c.name, name: containerLabel(c, containers.data ?? []) });
    setPicked(c.id);
  };
  const pickService = (s: MachineService) => {
    drop();
    fields.set({ prefix: s.prefix, upstream: s.upstream });
    setLink({ name: s.name });
    setPicked(s.key);
  };

  const canSubmit = fields.valid && !pending;

  return (
    <Overlay onClose={onClose}>
      <h2 className="text-base font-semibold text-slate-100">Add route</h2>

      <div className="mt-4 flex gap-1 rounded-lg border border-slate-800 p-1">
        <SourceTab active={source === "container"} onClick={() => showList("container")} icon={<ContainerIcon className="h-3.5 w-3.5" />}>
          Container
        </SourceTab>
        {mayMachines && (
          <SourceTab active={source === "machines"} onClick={() => showList("machines")} icon={<Server className="h-3.5 w-3.5" />}>
            Machines
          </SourceTab>
        )}
      </div>

      {/* One height on both lists, so switching doesn't move the fields and buttons. */}
      <div className="mt-3 h-40 overflow-y-auto">
        {source === "container" && (
          <PickList empty="No unrouted containers.">
            {unroutedContainers.map((c) => (
              <PickItem key={c.id} active={picked === c.id} onClick={() => pickContainer(c)} title={c.name} sub={c.image} />
            ))}
          </PickList>
        )}
        {source === "machines" && (
          <PickList
            empty={
              running.isLoading ? (
                "Reading what runs there…"
              ) : initialMachine ? (
                "This machine has no SSH set up — its address is in the fields below; add the port."
              ) : (
                <>
                  No machine with SSH set up — set one up on the{" "}
                  <Link to="/machines" className="underline underline-offset-2 hover:text-slate-300">
                    Machines
                  </Link>{" "}
                  tab, or type an address below.
                </>
              )
            }
          >
            {groups.map((g) => (
              <div key={g.machine.id} className="space-y-1">
                <p className="px-1 pt-1 text-[11px] font-medium uppercase text-slate-500">{machineLabel(g.machine)}</p>
                {g.services.map((s) => (
                  <PickItem key={s.key} active={picked === s.key} onClick={() => pickService(s)} title={s.name} sub={`${s.upstream} · ${s.kind}`} />
                ))}
                {g.services.length === 0 && !g.note && <p className="px-1 text-xs text-slate-600">Nothing more to route here.</p>}
                {g.note && <p className="px-1 text-xs text-amber-300/80">{g.note}</p>}
              </div>
            ))}
          </PickList>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 px-1 text-xs text-slate-500">
        <span title="A route on a named machine's address is listed under it, and moves with it">
          Pick one, or type any address below.
        </span>
        {picked && (
          <button type="button" onClick={clear} className="text-teal-400 hover:text-teal-300 hover:underline">
            Clear
          </button>
        )}
      </div>

      <RouteFields
        fields={fields}
        hosts={hosts}
        follow={
          pickedContainer
            ? {
                on: follow,
                derived,
                set: (on) => {
                  setFollow(on);
                  if (on && derived) fields.set({ upstream: derived });
                },
              }
            : undefined
        }
      />
      <SchemeSelect value={scheme} onChange={setScheme} />

      <p className="mt-4 text-xs text-slate-500">
        →{" "}
        <span className="font-mono text-slate-300">
          {scheme === "http" ? `http://${fields.fqdn}` : `https://${fields.fqdn}`}
        </span>
      </p>
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}

      <RouteFormFooter
        label="Add route"
        pending={pending}
        disabled={!canSubmit}
        onCancel={onClose}
        onSubmit={() =>
          onSubmit({
            ...fields.payload(),
            scheme,
            ...link,
            ...(link.container ? { follow_container: follow } : {}),
          })
        }
      />
    </Overlay>
  );
}

function SourceTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${
        active ? "bg-teal-500/15 text-teal-200" : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function PickList({ empty, children }: { empty: React.ReactNode; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const isEmpty = items.length === 0 || items.every((c) => !c);
  return (
    <div className="space-y-1">
      {isEmpty ? <p className="py-3 text-center text-xs text-slate-600">{empty}</p> : children}
    </div>
  );
}

function PickItem({ active, onClick, title, sub }: { active: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full flex-col items-start rounded-lg border px-3 py-2 text-left ${
        active ? "border-teal-600 bg-teal-500/10" : "border-slate-800 hover:bg-slate-800/60"
      }`}
    >
      <span className="text-sm text-slate-100">{title}</span>
      <span className="truncate font-mono text-[11px] text-slate-500">{sub}</span>
    </button>
  );
}
