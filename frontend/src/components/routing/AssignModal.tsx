import { useState } from "react";

import { RouteFields } from "./RouteFields";
import { useRouteFields, type RouteMode } from "./useRouteFields";

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
  const [routeMode, setRouteMode] = useState<RouteMode>(initialRouteMode);
  const isDnsOnly = allowDnsOnly && routeMode === "dns_only";
  const fields = useRouteFields({
    mode,
    baseDomain,
    isDnsOnly,
    initialPrefix,
    initialUpstream,
    initialTls,
  });
  if (!open) return null;

  const canSubmit = fields.valid && !pending;

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

        <RouteFields
          fields={fields}
          autoFocus
          preview={
            <span className="mt-1 block text-xs text-slate-500">
              → <span className="text-teal-300">{fields.fqdn}</span>
            </span>
          }
        />

        {!isDnsOnly && (
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={fields.tls}
              onChange={(e) => fields.setTls(e.target.checked)}
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
            onClick={() => onSubmit(fields.payload())}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}
