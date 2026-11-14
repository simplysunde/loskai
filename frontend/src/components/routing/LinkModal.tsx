import { useState } from "react";

import { INPUT } from "../../lib/ui";
import { Overlay } from "../shared/Modal";
import { hostOptions } from "./hostOptions";
import { OpensAt, RouteFields, RouteFormFooter } from "./RouteFields";
import type { Instance } from "./ServiceTable";
import { useRouteFields } from "./useRouteFields";

export interface LinkPayload {
  name: string;
  upstream: string;
  upstream_tls: boolean;
  follow_container?: boolean;
}

// A link's form (Phase 45): its name and the address the Dashboard opens — editing a link,
// or making one of a record with no route (a recipe install's, while Caddy isn't set up).
// The address is the browser's, so a container's pre-fill is its published port.
// Presentational: the parent posts to /api/links with the row's id.
export function LinkModal({
  row,
  published = null,
  dockerHost = null,
  rows = [],
  pending = false,
  error,
  onSubmit,
  onClose,
}: {
  row: Instance;
  // The row's container's published address now — what a following link uses — or null.
  published?: string | null;
  dockerHost?: string | null;
  rows?: Instance[];
  pending?: boolean;
  error?: string | null;
  onSubmit: (link: LinkPayload) => void;
  onClose: () => void;
}) {
  const editing = row.route_mode === "direct";
  const [name, setName] = useState(row.name);
  const [following, setFollowing] = useState(
    editing ? Boolean(row.follow_container) : Boolean(row.container && published),
  );
  const fields = useRouteFields({
    mode: "lan",
    baseDomain: null,
    // A link keeps its address. A container's record may hold its old route's, which can be
    // a Docker service name a browser can't open — so it starts at the published port, else
    // the Docker host. Anything else's stored address is a LAN one, and a fine start.
    initialUpstream:
      (following ? published : null) ??
      (editing || !row.container ? row.upstream : published) ??
      (dockerHost ? `${dockerHost}:` : ""),
    initialTls: row.upstream_tls ?? false,
  });

  const canSubmit = Boolean(name.trim()) && fields.upstreamOk && !pending;
  return (
    <Overlay onClose={onClose}>
      <h2 className="text-base font-semibold text-slate-100">{editing ? "Edit link" : "Make a link"}</h2>
      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-slate-400">Name</span>
        <input
          aria-label="Name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className={INPUT}
        />
      </label>
      <RouteFields
        fields={fields}
        link
        hosts={hostOptions({ rows, dockerHost })}
        follow={row.container ? fields.follow(following, setFollowing, published ?? null) : undefined}
      />
      <OpensAt url={fields.opensAt("link")} />
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      <RouteFormFooter
        label="Save link"
        pending={pending}
        disabled={!canSubmit}
        onCancel={onClose}
        onSubmit={() =>
          onSubmit({
            name: name.trim(),
            upstream: fields.upstream,
            upstream_tls: fields.tls,
            ...(row.container ? { follow_container: following } : {}),
          })
        }
      />
    </Overlay>
  );
}
