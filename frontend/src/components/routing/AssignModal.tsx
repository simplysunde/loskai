import { useState } from "react";

import {
  assembleFqdn,
  isValidDnsOnlyPrefix,
  isValidDnsTarget,
  isValidPrefix,
  isValidUpstream,
} from "../../lib/validation";

type RouteMode = "proxy" | "dns_only";

// Assign URL form: a single-label prefix + an upstream host:port, with the assembled
// FQDN shown live, plus a Proxied/DNS-only mode toggle (external instances only — see
// `allowDnsOnly`). Presentational — submit is handed to onSubmit (wired to /api/assign).
// The upstream hint follows the Caddy mode (Docker names vs LAN IPs).
export function AssignModal({
  open,
  baseDomain,
  mode,
  pending = false,
  error,
  allowDnsOnly = false,
  onSubmit,
  onClose,
  initialPrefix = "",
  initialUpstream = "",
  initialTls = false,
  initialRouteMode = "proxy",
}: {
  open: boolean;
  baseDomain: string | null;
  mode: "docker" | "lan" | null;
  pending?: boolean;
  error?: string | null;
  // A container-backed instance always stays proxy — its own IP is rarely meaningful as
  // a bare DNS target, so the toggle is hidden for those rows.
  allowDnsOnly?: boolean;
  onSubmit: (payload: {
    prefix: string;
    upstream: string;
    upstream_tls: boolean;
    route_mode: RouteMode;
  }) => void;
  onClose: () => void;
  // Prefilled when re-assigning an existing instance (the modal is keyed per target so
  // these seed fresh state on each open).
  initialPrefix?: string;
  initialUpstream?: string;
  initialTls?: boolean;
  initialRouteMode?: RouteMode;
}) {
  const [prefix, setPrefix] = useState(initialPrefix);
  const [upstream, setUpstream] = useState(initialUpstream);
  const [tls, setTls] = useState(initialTls);
  const [routeMode, setRouteMode] = useState<RouteMode>(initialRouteMode);
  if (!open) return null;

  const isDnsOnly = allowDnsOnly && routeMode === "dns_only";
  const prefixOk = isDnsOnly ? isValidDnsOnlyPrefix(prefix) : isValidPrefix(prefix);
  const upstreamOk = isDnsOnly ? isValidDnsTarget(upstream) : isValidUpstream(upstream);
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
  const canSubmit = prefixOk && upstreamOk && !pending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-100">Assign URL</h2>

        {allowDnsOnly && (
          <div className="mt-4 flex gap-1 rounded-lg border border-slate-800 p-1">
            <button
              onClick={() => setRouteMode("proxy")}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${
                routeMode === "proxy" ? "bg-teal-500/15 text-teal-200" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Proxied
            </button>
            <button
              onClick={() => setRouteMode("dns_only")}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${
                routeMode === "dns_only" ? "bg-teal-500/15 text-teal-200" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              DNS-only
            </button>
          </div>
        )}

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            {isDnsOnly ? "Hostname (dots allowed)" : "Subdomain prefix"}
          </span>
          <input
            autoFocus
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toLowerCase())}
            placeholder={isDnsOnly ? "rack1.vm3" : "grafana"}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
          />
          <span className="mt-1 block text-xs text-slate-500">
            → <span className="text-teal-300">{fqdn}</span>
          </span>
          {prefix && !prefixOk && (
            <span className="mt-1 block text-xs text-rose-400">
              {isDnsOnly
                ? "Each dot-separated label: lowercase letters, digits, hyphens."
                : "Single DNS label only: lowercase letters, digits, hyphens."}
            </span>
          )}
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
          {upstream && !upstreamOk && (
            <span className="mt-1 block text-xs text-rose-400">
              {isDnsOnly ? "A bare IPv4 address — no port." : "Use host:port — no scheme (http://) or path."}
            </span>
          )}
        </label>

        {!isDnsOnly && (
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={tls}
              onChange={(e) => setTls(e.target.checked)}
              className="mt-0.5 accent-teal-500"
            />
            <span>
              Backend speaks HTTPS
              <span className="block text-xs text-slate-500">
                Dial the upstream over TLS, accepting a self-signed cert (e.g. Proxmox).
              </span>
            </span>
          </label>
        )}

        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            onClick={onClose}
          >
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
              })
            }
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}
