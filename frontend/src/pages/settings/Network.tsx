import type { ReactNode } from "react";
import { ExternalLink, Lock, Router, Shield } from "lucide-react";

import { useHealth } from "../../lib/useHealth";
import { PeerDnsReminder } from "../../components/settings/PeerDnsReminder";
import { InlineSettingsFields } from "../../components/shared/InlineSettingsFields";

const GATEWAY_FIELDS = [
  { key: "wireguard_dashboard_url", label: "Dashboard URL", hint: "http://…:51821" },
];
const ADGUARD_FIELDS = [
  { key: "adguard_url", label: "URL", hint: "http://…:3000" },
  { key: "adguard_user", label: "Username" },
  { key: "adguard_password", label: "Password" },
];
const CADDY_FIELDS = [
  { key: "caddy_admin_url", label: "Admin URL", hint: "http://…:2019" },
  { key: "caddy_host_ip", label: "LAN IP", hint: "bare IP, e.g. 192.168.10.100" },
];

// How Loskai reaches the three infrastructure services it drives. Configuration only —
// fields commit on blur/Enter (partial PUT, same settings.json keys). Live status and the
// link-outs for AdGuard + Caddy belong to the Routing tab, which is what actually pushes
// their state. WireGuard is the exception: Loskai never writes to it, so it has no presence
// in Routing and keeps its convenience link here.
export function Network() {
  const health = useHealth();
  const h = health.data;
  const gatewayUrl = h?.wireguard?.url ?? null;

  return (
    <div className="max-w-xl space-y-8">
      <Section
        icon={<Shield className="h-4 w-4" />}
        name="AdGuard"
        subtitle="DNS rewrites — one per routed name, pointing at Caddy."
      >
        <InlineSettingsFields fields={ADGUARD_FIELDS} />
      </Section>

      <Section
        icon={<Lock className="h-4 w-4" />}
        name="Caddy"
        subtitle="TLS + reverse proxy. The LAN IP is what DNS rewrites answer with."
      >
        <InlineSettingsFields fields={CADDY_FIELDS} />
      </Section>

      <Section
        icon={<Router className="h-4 w-4" />}
        name="WireGuard"
        subtitle="Remote access. Loskai only links to the dashboard — it never configures it."
        action={
          <a
            href={gatewayUrl ?? undefined}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${
              gatewayUrl
                ? "border-slate-700 text-slate-200 hover:bg-slate-800"
                : "pointer-events-none border-slate-800 text-slate-600"
            }`}
          >
            Open <ExternalLink className="h-3.5 w-3.5" />
          </a>
        }
      >
        <InlineSettingsFields fields={GATEWAY_FIELDS} />
        <div className="mt-4">
          <PeerDnsReminder dnsHint={h?.wireguard?.dns_hint} />
        </div>
      </Section>
    </div>
  );
}

function Section({
  icon,
  name,
  subtitle,
  action,
  children,
}: {
  icon: ReactNode;
  name: string;
  subtitle: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-slate-200">{name}</h2>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
