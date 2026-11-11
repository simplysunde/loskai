// AdGuard as the Routing tab's pill routes it: linked by `origin`, so routing it again edits
// the same record. (WireGuard and the Certificate page, once routed the same way from the
// picker, are typed in by hand now — the backend still knows their origins.)
export const ADGUARD_SERVICE = { origin: "adguard", name: "AdGuard", prefix: "adguard" } as const;

export function urlToUpstream(url?: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return "";
  }
}
