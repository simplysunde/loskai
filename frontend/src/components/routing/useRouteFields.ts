import { useState } from "react";

import { assembleFqdn, isValidPrefix, isValidUpstream } from "../../lib/validation";

// The prefix + upstream + TLS trio both route modals collect: state, validation, and the
// copy that depends on Caddy's mode. It lives in one place because the two surfaces had
// already drifted — AddRouteModal was missing the prefix lowercasing and every hint
// AssignModal shows (Phase 15 F2), which is only possible while each keeps its own copy.
//
// Routes only. Naming a machine is a different shape — a dotted hostname and a bare
// address, no port, no TLS — and collects its own fields in AddMachineModal rather than
// bending these through an `isDnsOnly` flag (Phase 21e).
export function useRouteFields({
  mode,
  baseDomain,
  initialPrefix = "",
  initialUpstream = "",
  initialTls = false,
}: {
  mode: "docker" | "lan" | null;
  baseDomain: string | null;
  initialPrefix?: string;
  initialUpstream?: string;
  initialTls?: boolean;
}) {
  const [prefix, setPrefix] = useState(initialPrefix);
  const [upstream, setUpstream] = useState(initialUpstream);
  const [tls, setTls] = useState(initialTls);

  const prefixOk = isValidPrefix(prefix);
  const upstreamOk = isValidUpstream(upstream);

  return {
    prefix,
    upstream,
    tls,
    // Prefixes are lowercase-only (isValidPrefix), so normalise rather than reject:
    // typing a capital must not silently disable the submit button.
    setPrefix: (value: string) => setPrefix(value.toLowerCase()),
    setUpstream,
    setTls,
    set: (next: { prefix?: string; upstream?: string; tls?: boolean }) => {
      if (next.prefix !== undefined) setPrefix(next.prefix);
      if (next.upstream !== undefined) setUpstream(next.upstream);
      if (next.tls !== undefined) setTls(next.tls);
    },
    prefixOk,
    upstreamOk,
    valid: prefixOk && upstreamOk,
    fqdn: assembleFqdn(prefix || "name", baseDomain || "BASE_DOMAIN"),
    upstreamHint:
      mode === "docker" ? "e.g. grafana:3000" : "e.g. 192.168.10.100:3000",
    upstreamHelp:
      mode === "docker"
        ? "Caddy shares a Docker network with this container, so it can dial it by name."
        : "Must be reachable from wherever Caddy runs — a LAN IP:port. A container name resolves only if Caddy shares a Docker network with it.",
    // What both route modals post to /api/routes; AddRouteModal spreads its links on top.
    payload: () => ({
      prefix,
      upstream: upstream.trim(),
      upstream_tls: tls,
    }),
  };
}

export type RouteFieldsState = ReturnType<typeof useRouteFields>;
