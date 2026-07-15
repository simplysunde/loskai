import { useState } from "react";

import { assembleFqdn, isValidPrefix, isValidUpstream } from "../../lib/validation";

// Assign URL form: a single-label prefix + an upstream host:port, with the assembled
// FQDN shown live. Presentational — submit is handed to onSubmit (wired to /api/assign
// in Phase 6). The upstream hint follows the Caddy mode (Docker names vs LAN IPs).
export function AssignModal({
  open,
  baseDomain,
  mode,
  pending = false,
  error,
  onSubmit,
  onClose,
  initialPrefix = "",
  initialUpstream = "",
  initialTls = false,
}: {
  open: boolean;
  baseDomain: string | null;
  mode: "docker" | "lan" | null;
  pending?: boolean;
  error?: string | null;
  onSubmit: (payload: { prefix: string; upstream: string; upstream_tls: boolean }) => void;
  onClose: () => void;
  // Prefilled when re-assigning an existing instance (the modal is keyed per target so
  // these seed fresh state on each open).
  initialPrefix?: string;
  initialUpstream?: string;
  initialTls?: boolean;
}) {
  const [prefix, setPrefix] = useState(initialPrefix);
  const [upstream, setUpstream] = useState(initialUpstream);
  const [tls, setTls] = useState(initialTls);
  if (!open) return null;

  const prefixOk = isValidPrefix(prefix);
  const upstreamOk = isValidUpstream(upstream);
  const upstreamHint =
    mode === "docker" ? "e.g. grafana:3000" : "e.g. 192.168.10.100:3000";
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

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            Subdomain prefix
          </span>
          <input
            autoFocus
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toLowerCase())}
            placeholder="grafana"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
          />
          <span className="mt-1 block text-xs text-slate-500">
            → <span className="text-teal-300">{fqdn}</span>
          </span>
          {prefix && !prefixOk && (
            <span className="mt-1 block text-xs text-rose-400">
              Single DNS label only: lowercase letters, digits, hyphens.
            </span>
          )}
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            Upstream (host:port)
          </span>
          <input
            value={upstream}
            onChange={(e) => setUpstream(e.target.value)}
            placeholder={upstreamHint}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
          />
          {upstream && !upstreamOk && (
            <span className="mt-1 block text-xs text-rose-400">
              Use host:port — no scheme (http://) or path.
            </span>
          )}
        </label>

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
            onClick={() => onSubmit({ prefix, upstream: upstream.trim(), upstream_tls: tls })}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}
