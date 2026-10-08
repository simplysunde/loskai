// Built-in network services, in picker order. Caddy's cert page proxies to Caddy's own :80.
export const NETWORK_SERVICES = [
  { origin: "adguard", name: "AdGuard", prefix: "adguard", urlKey: "adguard_url" },
  { origin: "gateway", name: "WireGuard", prefix: "wg", urlKey: "wireguard_dashboard_url" },
  { origin: "caddy", name: "Certificate page", prefix: "setup", urlKey: null },
] as const;

export function urlToUpstream(url?: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return "";
  }
}
