// A subdomain is a single DNS label: lowercase letters, digits, hyphens; not starting
// or ending with a hyphen. Single-label only keeps every name under the one
// *.BASE_DOMAIN wildcard cert (see docs/project/architecture.md, Routing). Only applies to `proxy` routes —
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

// The route forms collect an upstream as two fields, host and port. `splitUpstream` takes a
// stored or pasted "host:port" apart at its last colon; a value with no port is all host.
export function splitUpstream(value: string): { host: string; port: string } {
  const v = value.trim();
  const idx = v.lastIndexOf(":");
  if (idx < 0) return { host: v, port: "" };
  return { host: v.slice(0, idx), port: v.slice(idx + 1) };
}

// Just the host half: an IP or a name, nothing else — no scheme, path, port or whitespace.
// (IPv6 literals are out of scope, as for isValidDnsTarget.)
export function isValidHost(host: string): boolean {
  const h = host.trim();
  return h.length > 0 && !/[\s/:]/.test(h);
}

export function isValidPort(port: string): boolean {
  const p = port.trim();
  return /^\d+$/.test(p) && +p >= 1 && +p <= 65535;
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

// A host folder a recipe mounts (an `env` entry with `type: path`). Mirrors the backend's
// recipes.path_problem — each of these installs fine and mounts somewhere unintended: `~`
// expands inside Loskai's container (compose runs as root there: /root), a bare name is a
// Docker volume rather than a folder, and a ':' splits the volume spec.
export function pathProblem(value: string): string | null {
  const v = value.trim();
  if (v.startsWith("~")) return "'~' would be the Loskai container's home (/root), not yours — write the full path";
  if (v.includes(":")) return "A path can't contain ':' — it would split the volume spec";
  if (v && !/^(\/|\.\/|\.\.\/)/.test(v)) return `Start a relative path with ./ — a bare '${v}' is a Docker volume, not a folder`;
  return null;
}
