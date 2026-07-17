import { useState } from "react";
import { Check, Copy, Lock, Router, Shield } from "lucide-react";

import { useHealth } from "../lib/useHealth";
import { PeerDnsReminder } from "../components/network/PeerDnsReminder";
import { ServicePanel } from "../components/network/ServicePanel";

// The Network tab: the infrastructure services Loskai works with — AdGuard (DNS), the
// WireGuard gateway, and Caddy (TLS + the CA-onboarding page). Status + link-out per
// service; URL config and per-service Assign land in later Phase 10b steps.
export function Network() {
  const health = useHealth();
  const h = health.data;
  // AdGuard's answer IP *is* the Caddy host IP — the cert-onboarding page is served there
  // over plain HTTP by IP (see docs/certificate-setup.md).
  const caddyIp = h?.adguard?.answer_ip ?? null;
  const certUrl = caddyIp ? `http://${caddyIp}/` : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">Network</h1>
        <p className="mt-1 text-sm text-slate-500">
          The infrastructure services Loskai works with — DNS, VPN gateway, and TLS.
        </p>
      </header>

      <div className="grid items-start gap-4 md:grid-cols-2">
        <ServicePanel
          icon={<Shield className="h-5 w-5" />}
          name="AdGuard"
          subtitle="DNS rewrites"
          status={h?.adguard?.status ?? "unconfigured"}
          linkUrl={h?.adguard?.url}
          linkLabel="Open AdGuard"
        >
          {h?.adguard?.answer_ip && (
            <p className="text-xs text-slate-500">
              Names resolve to{" "}
              <span className="font-mono text-slate-400">{h.adguard.answer_ip}</span> (Caddy).
            </p>
          )}
        </ServicePanel>

        <ServicePanel
          icon={<Router className="h-5 w-5" />}
          name="Gateway"
          subtitle="WireGuard remote access"
          status={h?.wireguard?.status ?? "unconfigured"}
          linkUrl={h?.wireguard?.url}
          linkLabel="Open wg-dashboard"
        >
          <PeerDnsReminder dnsHint={h?.wireguard?.dns_hint} />
        </ServicePanel>

        <ServicePanel
          icon={<Lock className="h-5 w-5" />}
          name="Caddy"
          subtitle="TLS / reverse proxy"
          status={h?.caddy?.status ?? "unconfigured"}
          linkUrl={certUrl}
          linkLabel="Certificate setup"
        >
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              Install Caddy's root CA on a LAN device once and every{" "}
              <span className="font-mono text-slate-300">*.domain</span> name is trusted.
              Share the by-IP link:
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
