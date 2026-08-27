import { useState } from "react";

import {
  assembleFqdn,
  isValidDnsOnlyPrefix,
  isValidDnsTarget,
  isValidPrefix,
  isValidUpstream,
} from "../../lib/validation";

export type RouteMode = "proxy" | "dns_only";

// The prefix + upstream + TLS trio both route modals collect: state, validation, and the
// copy that depends on Caddy's mode. It lives in one place because the two surfaces had
// already drifted — AddRouteModal was missing the prefix lowercasing and every hint
// AssignModal shows (Phase 15 F2), which is only possible while each keeps its own copy.
export function useRouteFields({
  mode,
  baseDomain,
  isDnsOnly,
  initialPrefix = "",
  initialUpstream = "",
  initialTls = false,
}: {
  mode: "docker" | "lan" | null;
  baseDomain: string | null;
  // Owned by the caller: each modal decides when DNS-only is even offered.
  isDnsOnly: boolean;
  initialPrefix?: string;
  initialUpstream?: string;
  initialTls?: boolean;
}) {
  const [prefix, setPrefix] = useState(initialPrefix);
  const [upstream, setUpstream] = useState(initialUpstream);
  const [tls, setTls] = useState(initialTls);

  const prefixOk = isDnsOnly ? isValidDnsOnlyPrefix(prefix) : isValidPrefix(prefix);
  const upstreamOk = isDnsOnly ? isValidDnsTarget(upstream) : isValidUpstream(upstream);

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
    isDnsOnly,
    prefixOk,
    upstreamOk,
    valid: prefixOk && upstreamOk,
    fqdn: assembleFqdn(prefix || "name", baseDomain || "BASE_DOMAIN"),
    upstreamHint: isDnsOnly
      ? "e.g. 192.168.10.55"
      : mode === "docker"
        ? "e.g. grafana:3000"
        : "e.g. 192.168.10.100:3000",
    upstreamHelp: isDnsOnly
      ? "A bare LAN IP — DNS resolves the name straight to this address, no proxy, no TLS."
      : mode === "docker"
        ? "A container name:port on the Docker network — Caddy resolves it there."
        : "Must be reachable from the Caddy host: a LAN IP:port. Container names and localhost won't resolve from a separate Caddy LXC.",
    // What both modals post to /api/assign; AddRouteModal spreads its link fields on top.
    payload: () => ({
      prefix,
      upstream: upstream.trim(),
      upstream_tls: isDnsOnly ? false : tls,
      route_mode: (isDnsOnly ? "dns_only" : "proxy") as RouteMode,
    }),
  };
}

export type RouteFieldsState = ReturnType<typeof useRouteFields>;
