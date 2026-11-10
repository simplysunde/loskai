import { useState } from "react";
import { Container as ContainerIcon, Globe, Server } from "lucide-react";
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

export type Source = "container" | "machines" | "external";

// "Add route" picker: choose a source (an unrouted Container, something running on a
// Machine, or a fresh External target), which pre-fills the prefix + upstream; the fields
// stay editable. What already has a route is left out (it's managed as a row). This is the
// single route-creation surface — the Docker tab no longer assigns.
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
  // Opened from a machine's row on the Machines tab: what runs there, or — when that
  // can't be read — External, on its address. The address is what puts the route on it.
  initialMachine?: { id: string; address: string };
  pending?: boolean;
  error?: string | null;
  onSubmit: (route: NewRoute) => void;
  onClose: () => void;
}) {
  // Only an account that may use the Machines tab may read what runs on them.
  const mayMachines = useMe().may("machines");
  const running = useRunning(open && mayMachines);
  const [source, setSource] = useState<Source>(() =>
    initialMachine ? (running.data?.[initialMachine.id]?.ok ? "machines" : "external") : "container",
  );
  const [link, setLink] = useState<{ container?: string; name?: string }>({});
  const [picked, setPicked] = useState<string | null>(null);
  // A picked container's route follows it by default whenever its address can be derived.
  const [follow, setFollow] = useState(false);
  const [derived, setDerived] = useState<string | null>(null);
  const [scheme, setScheme] = useState<Scheme>("https");
  // A picked container answers the hint for itself; `mode` is the deployment-wide
  // fallback, used by the Network-service and External sources, which have no container.
  const [pickedMode, setPickedMode] = useState<"docker" | "lan" | null>(null);
  // External on a machine starts on its address; only the port is left to type.
  const machineUpstream = initialMachine ? `${initialMachine.address}:` : "";
  const fields = useRouteFields({
    mode: pickedMode ?? mode,
    baseDomain,
    initialUpstream: source === "external" ? machineUpstream : "",
  });

  const containers = useContainers({ enabled: open });
  // The rows the Routing page already fetched — no extra endpoint — for the host dropdown's
  // machines. Unlike the Container and Machines sources these are NOT filtered by whether
  // they are routed: you are borrowing the address, not routing the thing, so a NAS that
  // already answers to its own name is still a valid upstream for a new route.
  const rows = useRoutes(open);
  const settings = useSettings(open);


  if (!open) return null;

  const unroutedContainers = (containers.data ?? []).filter((c) => !c.subdomain);
  const pickedContainer =
    source === "container" ? (containers.data ?? []).find((c) => c.id === picked) : undefined;
  const hosts = hostOptions({
    rows: rows.data,
    dockerHost: settings.data?.host_ip?.value,
    containerHost: pickedContainer?.suggested_host,
  });
  const groups = machineServices(rows.data ?? [], running.data, settings.data?.host_ip?.value).filter(
    (g) => !initialMachine || g.machine.id === initialMachine.id,
  );

  const reset = (next: Source) => {
    setSource(next);
    fields.set({ prefix: "", upstream: next === "external" ? machineUpstream : "", tls: false });
    setLink({});
    setPicked(null);
    setPickedMode(null);
    setFollow(false);
    setDerived(null);
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
    fields.set({ prefix: s.prefix, upstream: s.upstream });
    setLink({ name: s.name });
    setPicked(s.key);
  };

  const canSubmit = fields.valid && !pending;

  return (
    <Overlay onClose={onClose}>
      <h2 className="text-base font-semibold text-slate-100">Add route</h2>

      <div className="mt-4 flex gap-1 rounded-lg border border-slate-800 p-1">
        <SourceTab active={source === "container"} onClick={() => reset("container")} icon={<ContainerIcon className="h-3.5 w-3.5" />}>
          Container
        </SourceTab>
        {mayMachines && (
          <SourceTab active={source === "machines"} onClick={() => reset("machines")} icon={<Server className="h-3.5 w-3.5" />}>
            Machines
          </SourceTab>
        )}
        <SourceTab active={source === "external"} onClick={() => reset("external")} icon={<Globe className="h-3.5 w-3.5" />}>
          External
        </SourceTab>
      </div>

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
            <>
              No machine with SSH set up — set one up on the{" "}
              <Link to="/machines" className="underline underline-offset-2 hover:text-slate-300">
                Machines
              </Link>{" "}
              tab, or use External.
            </>
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
      {source === "external" && (
        <>
          <p className="mt-1 text-xs text-slate-500">
            Any address. A route on a named machine's address is listed under it, and moves
            with it. Machines are named on the{" "}
            <Link to="/machines" className="underline underline-offset-2 hover:text-slate-300">
              Machines
            </Link>{" "}
            tab.
          </p>
        </>
      )}

      <RouteFields
        fields={fields}
        hosts={hosts}
        follow={
          source === "container" && picked
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
            ...(source === "container" && picked ? { follow_container: follow } : {}),
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
    <div className="mt-3 max-h-40 space-y-1 overflow-y-auto">
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
