import { useState } from "react";

import { OpensAt, RouteFields, RouteFormFooter } from "./RouteFields";
import type { Instance } from "./ServiceTable";
import { useRouteFields } from "./useRouteFields";
import { SchemeSelect, type Scheme } from "./SchemeSelect";
import { hostOptions } from "./hostOptions";
import { Overlay } from "../shared/Modal";

// The route form for a row: a single-label prefix + an upstream host:port, with where it will open
// shown live. Presentational — submit is handed to onSubmit (wired to /api/routes). The
// upstream hint follows the Caddy mode (Docker names vs LAN IPs). Re-pointing a *machine*
// is a different form entirely and goes to AddMachineModal (Phase 21e).
export function AssignModal({
  open,
  baseDomain,
  upstreamMode,
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
  title = "Assign a URL",
}: {
  open: boolean;
  baseDomain: string | null;
  upstreamMode: "docker" | "lan" | null;
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
  rows?: Instance[];
  // Present only for a container's route: whether it starts out following, and the
  // container's live address (null when Docker can't name its port).
  follow?: { initial: boolean; derived: string | null };
  // The host dropdown's other entries, beside the named machines in `rows`.
  dockerHost?: string | null;
  containerHost?: string | null;
  // What opened it — Change URL, Assign a URL, Give it an HTTPS name (routes.assignLabel).
  title?: string;
}) {
  const [scheme, setScheme] = useState<Scheme>(initialScheme);
  const [following, setFollowing] = useState(follow?.initial ?? false);
  const fields = useRouteFields({
    upstreamMode,
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
      <h2 className="text-base font-semibold text-slate-100">{title}</h2>

      <RouteFields
        fields={fields}
        hosts={hosts}
        autoFocus
        follow={follow ? fields.follow(following, setFollowing, follow.derived) : undefined}
      />

      <SchemeSelect value={scheme} onChange={setScheme} />
      <OpensAt url={fields.opensAt(scheme)} />

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
