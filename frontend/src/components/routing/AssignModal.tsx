import { useState } from "react";

import { useEscape } from "../../lib/useEscape";
import { useScrollLock } from "../../lib/useScrollLock";
import { RouteFields } from "./RouteFields";
import type { RouteRow } from "./ServiceTable";
import { useRouteFields } from "./useRouteFields";
import { SchemeSelect, type Scheme } from "./SchemeSelect";
import { hostOptions } from "./hostOptions";

// Assign URL form: a single-label prefix + an upstream host:port, with the assembled FQDN
// shown live. Presentational — submit is handed to onSubmit (wired to /api/routes). The
// upstream hint follows the Caddy mode (Docker names vs LAN IPs). Re-pointing a *machine*
// is a different form entirely and goes to AddMachineModal (Phase 21e).
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
  initialScheme = "https",
  rows = [],
  follow,
  dockerHost = null,
  containerHost = null,
}: {
  open: boolean;
  baseDomain: string | null;
  mode: "docker" | "lan" | null;
  pending?: boolean;
  error?: string | null;
  onSubmit: (payload: {
    prefix: string;
    upstream: string;
    upstream_tls: boolean;
    scheme?: Scheme;
    follow_container?: boolean;
  }) => void;
  onClose: () => void;
  // Prefilled when re-assigning an existing instance (the modal is keyed per target so
  // these seed fresh state on each open).
  initialPrefix?: string;
  initialUpstream?: string;
  initialTls?: boolean;
  initialScheme?: Scheme;
  rows?: RouteRow[];
  // Present only for a container's route: whether it starts out following, and the
  // container's live address (null when Docker can't name its port).
  follow?: { initial: boolean; derived: string | null };
  // The host dropdown's other entries, beside the named machines in `rows`.
  dockerHost?: string | null;
  containerHost?: string | null;
}) {
  const [scheme, setScheme] = useState<Scheme>(initialScheme);
  const [following, setFollowing] = useState(follow?.initial ?? false);
  const fields = useRouteFields({
    mode,
    baseDomain,
    initialPrefix,
    initialUpstream,
    initialTls,
  });
  useScrollLock(open);
  useEscape(open, onClose);

  if (!open) return null;

  const canSubmit = fields.valid && !pending;
  const hosts = hostOptions({ rows, dockerHost, containerHost });

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

        <RouteFields
          fields={fields}
          hosts={hosts}
          autoFocus
          preview={
            <span className="mt-1 block text-xs text-slate-500">
              → <span className="text-teal-300">{fields.fqdn}</span>
            </span>
          }
          follow={
            follow
              ? {
                  on: following,
                  derived: follow.derived,
                  set: (on) => {
                    setFollowing(on);
                    if (on && follow.derived) fields.set({ upstream: follow.derived });
                  },
                }
              : undefined
          }
        />

        <SchemeSelect value={scheme} onChange={setScheme} />

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
                ...fields.payload(),
                scheme,
                ...(follow ? { follow_container: following } : {}),
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
