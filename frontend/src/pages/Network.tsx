import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Lock, Router, Shield } from "lucide-react";

import { api } from "../lib/api";
import { useHealth } from "../lib/useHealth";
import { PeerDnsReminder } from "../components/network/PeerDnsReminder";
import { ServicePanel } from "../components/network/ServicePanel";
import { SettingsFields, type SettingsView } from "../components/shared/SettingsFields";

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
  { key: "caddy_setup_url", label: "Certificate setup URL", hint: "defaults to http://<LAN IP>/" },
];

// The Network tab: the infrastructure services Loskai works with — the WireGuard gateway,
// AdGuard (DNS), and Caddy (TLS + the CA-onboarding page). Each panel shows health, a
// link-out, its config, and (Caddy) the by-IP certificate-setup link.
export function Network() {
  const health = useHealth();
  const h = health.data;
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsView>("/api/settings"),
  });

  // AdGuard's answer IP *is* the Caddy host IP; the cert page is served there over plain
  // HTTP by IP. Strip any stray scheme/port so we never emit `http://http://…`. An explicit
  // caddy_setup_url wins (needed when the port is remapped, e.g. dev's 8081:80).
  const caddyHost = (h?.adguard?.answer_ip ?? "")
    .replace(/^\w+:\/\//, "")
    .split("/")[0]
    .split(":")[0];
  const derived = caddyHost ? `http://${caddyHost}/` : null;
  const certUrl = settings.data?.caddy_setup_url?.value || derived;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">Network</h1>
        <p className="mt-1 text-sm text-slate-500">
          The infrastructure services Loskai works with — VPN gateway, DNS, and TLS.
        </p>
      </header>

      <div className="max-w-2xl space-y-4">
        <ServicePanel
          icon={<Router className="h-5 w-5" />}
          name="Gateway"
          subtitle="WireGuard remote access"
          status={h?.wireguard?.status ?? "unconfigured"}
          linkUrl={h?.wireguard?.url}
          linkLabel="Open"
        >
          <SettingsFields fields={GATEWAY_FIELDS} />
          <div className="mt-4">
            <PeerDnsReminder dnsHint={h?.wireguard?.dns_hint} />
          </div>
        </ServicePanel>

        <ServicePanel
          icon={<Shield className="h-5 w-5" />}
          name="AdGuard"
          subtitle="DNS rewrites"
          status={h?.adguard?.status ?? "unconfigured"}
          linkUrl={h?.adguard?.url}
          linkLabel="Open"
        >
          <SettingsFields fields={ADGUARD_FIELDS} />
          {h?.adguard?.answer_ip && (
            <p className="mt-3 text-xs text-slate-500">
              Names resolve to{" "}
              <span className="font-mono text-slate-400">{h.adguard.answer_ip}</span> (Caddy).
            </p>
          )}
        </ServicePanel>

        <ServicePanel
          icon={<Lock className="h-5 w-5" />}
          name="Caddy"
          subtitle="TLS / reverse proxy"
          status={h?.caddy?.status ?? "unconfigured"}
          linkUrl={certUrl}
          linkLabel="Cert page"
        >
          <SettingsFields fields={CADDY_FIELDS} />
          <div className="mt-4 space-y-2 border-t border-slate-800 pt-4">
            <p className="text-xs text-slate-400">
              Install Caddy's root CA on a LAN device once and every{" "}
              <span className="font-mono text-slate-300">*.domain</span> name is trusted.
              Share the link:
            </p>
            <CopyLink url={certUrl} />
          </div>
        </ServicePanel>
      </div>
    </div>
  );
}

function CopyLink({ url }: { url: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!url) {
    return (
      <p className="text-xs text-slate-600">
        Set the Caddy LAN IP so Loskai can derive the setup URL.
      </p>
    );
  }
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex w-full items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-left font-mono text-xs text-slate-300 hover:bg-slate-800"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 text-slate-500" />
      )}
      <span className="truncate">{url}</span>
    </button>
  );
}
