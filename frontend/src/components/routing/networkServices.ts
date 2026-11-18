// AdGuard as the Routing tab's pill routes it: linked by `origin`, so routing it again edits
// the same record. (WireGuard and the Certificate page, once routed the same way from the
// picker, are typed in by hand now — the backend still knows their origins.)
export const ADGUARD_SERVICE = { origin: "adguard", name: "AdGuard", prefix: "adguard" } as const;

// A URL as a route's upstream: its host and port — the port its scheme implies when it names
// none, since a route always has one.
export function urlToUpstream(url?: string | null): string {
  const u = parse(url);
  if (!u) return "";
  return `${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
}

// Whether that upstream is dialled over TLS.
export function urlUsesTls(url?: string | null): boolean {
  return parse(url)?.protocol === "https:";
}

function parse(url?: string | null): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
