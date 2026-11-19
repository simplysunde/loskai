import { useState } from "react";

import type { FollowState } from "./RouteFields";
import type { Scheme } from "./SchemeSelect";
import {
  assembleFqdn,
  isValidHost,
  isValidPort,
  isValidPrefix,
  splitUpstream,
} from "../../lib/validation";

// The prefix + upstream + TLS trio both route modals collect: state, validation, and the
// copy that depends on Caddy's mode. It lives in one place because the two surfaces had
// already drifted — AddRouteModal was missing the prefix lowercasing and every hint
// AssignModal shows (Phase 15 F2), which is only possible while each keeps its own copy.
//
// The upstream is collected as two fields — host and port — and posted as one "host:port".
// `set({ upstream })` still takes the joined form, which is what every prefill has.
//
// Routes only. Naming a machine is a different shape — a dotted hostname and a bare
// address, no port, no TLS — and collects its own fields in AddMachineModal rather than
// bending these through an `isDnsOnly` flag (Phase 21e).
export function useRouteFields({
  upstreamMode,
  baseDomain,
  initialPrefix = "",
  initialUpstream = "",
  initialTls = false,
}: {
  upstreamMode: "docker" | "lan" | null;
  baseDomain: string | null;
  initialPrefix?: string;
  initialUpstream?: string;
  initialTls?: boolean;
}) {
  const initial = splitUpstream(initialUpstream);
  const [prefix, setPrefix] = useState(initialPrefix);
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port);
  const [tls, setTls] = useState(initialTls);

  const prefixOk = isValidPrefix(prefix);
  const hostOk = isValidHost(host);
  const portOk = isValidPort(port);
  const setUpstream = (value: string) => {
    const next = splitUpstream(value);
    setHost(next.host);
    setPort(next.port);
  };

  return {
    prefix,
    host,
    port,
    upstream: `${host.trim()}:${port.trim()}`,
    tls,
    // Prefixes are lowercase-only (isValidPrefix), so normalise rather than reject:
    // typing a capital must not silently disable the submit button.
    setPrefix: (value: string) => setPrefix(value.toLowerCase()),
    // A pasted "host:port" lands in the host field more often than not — split it rather
    // than flag it. A scheme stays in, so it is shown as the mistake it is.
    setHost: (value: string) => {
      if (/^[^:/\s]+:\d{1,5}$/.test(value.trim())) setUpstream(value);
      else setHost(value);
    },
    setPort: (value: string) => setPort(value.replace(/\D/g, "").slice(0, 5)),
    setTls,
    set: (next: { prefix?: string; upstream?: string; tls?: boolean }) => {
      if (next.prefix !== undefined) setPrefix(next.prefix);
      if (next.upstream !== undefined) setUpstream(next.upstream);
      if (next.tls !== undefined) setTls(next.tls);
    },
    prefixOk,
    hostOk,
    portOk,
    upstreamOk: hostOk && portOk,
    valid: prefixOk && hostOk && portOk,
    hostHint: upstreamMode === "docker" ? "jellyfin.loskai-edge" : "192.168.10.100",
    upstreamHelp:
      upstreamMode === "docker"
        ? "Caddy shares a Docker network with this container, so it can dial it by name."
        : "Must be reachable from wherever Caddy runs — a LAN IP:port. A container name resolves only if Caddy shares a Docker network with it.",
    // Where the record will open once saved, as the server's open_url will put it: a link
    // at its address, over https when its backend speaks it; a route at its name, over
    // http only when it is HTTP only. Shown before saving — there is no record to ask yet.
    opensAt: (as: Scheme | "link") =>
      as === "link"
        ? `${tls ? "https" : "http"}://${host.trim()}:${port.trim()}`
        : `${as === "http" ? "http" : "https"}://${assembleFqdn(prefix || "name", baseDomain || "BASE_DOMAIN")}`,
    // Following a container: on, the upstream is its address now (`derived`) and locked.
    follow: (on: boolean, setOn: (on: boolean) => void, derived: string | null): FollowState => ({
      on,
      derived,
      set: (next) => {
        setOn(next);
        if (next && derived) setUpstream(derived);
      },
    }),
    // What both route modals post to /api/routes; AddRouteModal spreads its links on top.
    payload: () => ({
      prefix,
      upstream: `${host.trim()}:${port.trim()}`,
      upstream_tls: tls,
    }),
  };
}

export type RouteFieldsState = ReturnType<typeof useRouteFields>;
