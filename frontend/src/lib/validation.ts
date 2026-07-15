// A subdomain is a single DNS label: lowercase letters, digits, hyphens; not starting
// or ending with a hyphen. Single-label only keeps every name under the one
// *.BASE_DOMAIN wildcard cert (see PLAN, Assign URL).
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidPrefix(prefix: string): boolean {
  return prefix.length > 0 && prefix.length <= 63 && LABEL.test(prefix);
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
