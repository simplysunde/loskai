// A subdomain is a single DNS label: lowercase letters, digits, hyphens; not starting
// or ending with a hyphen. Single-label only keeps every name under the one
// *.BASE_DOMAIN wildcard cert (see PLAN, Assign URL). Only applies to `proxy` routes —
// `dns_only` has no cert involved, see isValidDnsOnlyPrefix below (mirrors assign.py's
// validate_prefix split).
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidPrefix(prefix: string): boolean {
  return prefix.length > 0 && prefix.length <= 63 && LABEL.test(prefix);
}

// dns_only prefixes may be dot-separated (e.g. "rack1.vm3") since no wildcard cert is
// involved — each label still has to be a valid DNS label on its own.
export function isValidDnsOnlyPrefix(prefix: string): boolean {
  return (
    prefix.length > 0 &&
    prefix.length <= 253 &&
    prefix.split(".").every((label) => LABEL.test(label))
  );
}

export function assembleFqdn(prefix: string, baseDomain: string): string {
  return `${prefix}.${baseDomain}`;
}

// An upstream is a bare host:port — it goes straight into Caddy's `dial`, so a scheme or
// path (e.g. https://host:8006/) would make a broken route. Mirrors the backend guard.
export function isValidUpstream(upstream: string): boolean {
  const u = upstream.trim();
  if (!u || /\s/.test(u) || u.includes("://") || u.includes("/")) return false;
  const idx = u.lastIndexOf(":");
  if (idx <= 0 || idx === u.length - 1) return false;
  const port = u.slice(idx + 1);
  return /^\d+$/.test(port) && +port >= 1 && +port <= 65535;
}

// A dns_only target is the AdGuard answer itself — a bare IPv4 address, no port, no
// scheme. IPv6 is out of scope for now (mirrors the backend's validate_upstream guard).
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isValidDnsTarget(value: string): boolean {
  const v = value.trim();
  const match = IPV4.exec(v);
  if (!match) return false;
  return match.slice(1).every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
}
