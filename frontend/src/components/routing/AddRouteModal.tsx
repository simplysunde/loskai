import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Container as ContainerIcon, Globe, Loader2, Network } from "lucide-react";
import { Link } from "react-router-dom";

import { api } from "../../lib/api";
import { useHealth } from "../../lib/useHealth";
import {
  assembleFqdn,
  isValidDnsOnlyPrefix,
  isValidDnsTarget,
  isValidPrefix,
  isValidUpstream,
} from "../../lib/validation";
import type { SettingsView } from "../shared/SettingsFields";

type RouteMode = "proxy" | "dns_only";

// The route payload the parent posts to /api/assign.
export interface NewRoute {
  prefix: string;
  upstream: string;
  upstream_tls: boolean;
  route_mode: RouteMode;
  container?: string;
  origin?: string;
  name?: string;
}

type Source = "container" | "network" | "external";

interface ContainerRow {
  id: string;
  name: string;
  image: string;
  subdomain: string | null;
  suggested_upstream: string | null;
}

// Built-in network services, in picker order. Caddy's cert page proxies to Caddy's own :80.
const NETWORK_SERVICES = [
  { origin: "adguard", name: "AdGuard", prefix: "adguard", urlKey: "adguard_url" },
  { origin: "gateway", name: "WireGuard", prefix: "wg", urlKey: "wireguard_dashboard_url" },
  { origin: "caddy", name: "Certificate page", prefix: "setup", urlKey: null },
] as const;

function urlToUpstream(url?: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return "";
  }
}

function suggestPrefix(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
}

// "Add route" picker: choose a source (an unrouted Container, a built-in Network service,
// or a fresh External target), which pre-fills the prefix + upstream; the fields stay
// editable. Routed containers/services are filtered out (they're managed as rows). This is
// the single route-creation surface — the Docker tab no longer assigns.
export function AddRouteModal({
  open,
  baseDomain,
  mode,
  pending = false,
  error,
  routedOrigins,
  onSubmit,
  onClose,
}: {
  open: boolean;
  baseDomain: string | null;
  mode: "docker" | "lan" | null;
  pending?: boolean;
  error?: string | null;
  routedOrigins: Set<string>;
  onSubmit: (route: NewRoute) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Source>("container");
  const [routeMode, setRouteMode] = useState<RouteMode>("proxy");
  const [prefix, setPrefix] = useState("");
  const [upstream, setUpstream] = useState("");
  const [tls, setTls] = useState(false);
  const [link, setLink] = useState<{ container?: string; origin?: string; name?: string }>({});
  const [picked, setPicked] = useState<string | null>(null);

  const containers = useQuery({
    queryKey: ["docker-containers"],
    queryFn: () => api.get<ContainerRow[]>("/api/docker/containers"),
    enabled: open,
    retry: false,
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsView>("/api/settings"),
    enabled: open,
  });
  const health = useHealth();

  if (!open) return null;

  const caddyHost = (health.data?.adguard?.answer_ip ?? "")
    .replace(/^\w+:\/\//, "")
    .split("/")[0]
    .split(":")[0];

  const unroutedContainers = (containers.data ?? []).filter((c) => !c.subdomain);
  const networkItems = NETWORK_SERVICES.filter((s) => !routedOrigins.has(s.origin)).map((s) => ({
    ...s,
    upstream: s.urlKey
      ? urlToUpstream(settings.data?.[s.urlKey]?.value)
      : caddyHost
        ? `${caddyHost}:80`
        : "",
  }));

  const reset = (next: Source) => {
    setSource(next);
    setRouteMode("proxy"); // Container/Network always imply proxy; External defaults to it too
    setPrefix("");
    setUpstream("");
    setTls(false);
    setLink({});
    setPicked(null);
  };

  const pickContainer = (c: ContainerRow) => {
    setPrefix(suggestPrefix(c.name));
    setUpstream(c.suggested_upstream ?? "");
    setLink({ container: c.name, name: c.name });
    setPicked(c.id);
  };
  const pickNetwork = (s: (typeof networkItems)[number]) => {
    setPrefix(s.prefix);
    setUpstream(s.upstream);
    setLink({ origin: s.origin, name: s.name });
    setPicked(s.origin);
  };

  const isDnsOnly = source === "external" && routeMode === "dns_only";
  const prefixOk = isDnsOnly ? isValidDnsOnlyPrefix(prefix) : isValidPrefix(prefix);
  const upstreamOk = isDnsOnly ? isValidDnsTarget(upstream) : isValidUpstream(upstream);
  const canSubmit = prefixOk && upstreamOk && !pending;
  const upstreamHint = isDnsOnly
    ? "e.g. 192.168.10.55"
    : mode === "docker"
      ? "e.g. grafana:3000"
      : "e.g. 192.168.10.100:3000";
  const upstreamHelp = isDnsOnly
    ? "A bare LAN IP — DNS resolves the name straight to this address, no proxy, no TLS."
    : mode === "docker"
      ? "A container name:port on the Docker network — Caddy resolves it there."
      : "Must be reachable from the Caddy host: a LAN IP:port. Container names and localhost won't resolve from a separate Caddy LXC.";
  const fqdn = assembleFqdn(prefix || "name", baseDomain || "BASE_DOMAIN");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-100">Add route</h2>

        <div className="mt-4 flex gap-1 rounded-lg border border-slate-800 p-1">
          <SourceTab active={source === "container"} onClick={() => reset("container")} icon={<ContainerIcon className="h-3.5 w-3.5" />}>
            Container
          </SourceTab>
          <SourceTab active={source === "network"} onClick={() => reset("network")} icon={<Network className="h-3.5 w-3.5" />}>
            Network
          </SourceTab>
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
        {source === "network" && (
          <>
            <PickList empty="All services are routed.">
              {networkItems.map((s) => (
                <PickItem key={s.origin} active={picked === s.origin} onClick={() => pickNetwork(s)} title={s.name} sub={s.upstream || "no URL set — see below"} />
              ))}
            </PickList>
            {networkItems.some((s) => !s.upstream) && (
              <p className="mt-2 text-xs text-slate-500">
                A service with no URL set gets one in{" "}
                <Link to="/settings/network" className="underline underline-offset-2 hover:text-slate-300">
                  Settings &rsaquo; Network
                </Link>
                .
              </p>
            )}
          </>
        )}
        {source === "external" && (
          <>
            <p className="mt-3 text-xs text-slate-500">A LAN service by address — fill in a name and its host:port below.</p>
            <div className="mt-3 flex gap-1 rounded-lg border border-slate-800 p-1">
              <SourceTab active={routeMode === "proxy"} onClick={() => setRouteMode("proxy")} icon={null}>
                Proxied
              </SourceTab>
              <SourceTab active={routeMode === "dns_only"} onClick={() => setRouteMode("dns_only")} icon={null}>
                DNS-only
              </SourceTab>
            </div>
          </>
        )}

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            {isDnsOnly ? "Hostname (dots allowed)" : "Subdomain prefix"}
          </span>
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder={isDnsOnly ? "rack1.vm3" : "grafana"}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
          />
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            {isDnsOnly ? "Machine IP" : "Upstream (host:port)"}
          </span>
          <input
            value={upstream}
            onChange={(e) => setUpstream(e.target.value)}
            placeholder={upstreamHint}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
          />
          <span className="mt-1 block text-xs text-slate-500">{upstreamHelp}</span>
        </label>
        {!isDnsOnly && (
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />
            Backend speaks HTTPS (skip cert verification)
          </label>
        )}

        <p className="mt-4 text-xs text-slate-500">
          → <span className="font-mono text-slate-300">{isDnsOnly ? fqdn : `https://${fqdn}`}</span>
        </p>
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                prefix,
                upstream: upstream.trim(),
                upstream_tls: isDnsOnly ? false : tls,
                route_mode: isDnsOnly ? "dns_only" : "proxy",
                ...link,
              })
            }
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Add route
          </button>
        </div>
      </div>
    </div>
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

function PickList({ empty, children }: { empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const isEmpty = items.every((c) => !c);
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
