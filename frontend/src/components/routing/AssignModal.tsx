import { useState } from "react";

import { RouteFields, RouteFormFooter } from "./RouteFields";
import type { RouteRow } from "./ServiceTable";
import { useRouteFields } from "./useRouteFields";
import { SchemeSelect, type Scheme } from "./SchemeSelect";
import { hostOptions } from "./hostOptions";
import { Overlay } from "../shared/Modal";

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

  if (!open) return null;

  const canSubmit = fields.valid && !pending;
  const hosts = hostOptions({ rows, dockerHost, containerHost });

  return (
    <Overlay onClose={onClose}>
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

      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

      <RouteFormFooter
        label="Assign"
        pending={pending}
        disabled={!canSubmit}
        onCancel={onClose}
        onSubmit={() => onSubmit({ ...fields.payload(), scheme, ...(follow ? { follow_container: following } : {}) })}
      />
    </Overlay>
  );
}
