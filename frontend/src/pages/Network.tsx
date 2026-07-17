import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Lock, Plus, Router, Shield } from "lucide-react";

import { api, ApiError } from "../lib/api";
import { useHealth } from "../lib/useHealth";
import { AssignModal } from "../components/routing/AssignModal";
import { PeerDnsReminder } from "../components/network/PeerDnsReminder";
import { ServicePanel } from "../components/network/ServicePanel";
import { InlineSettingsFields } from "../components/shared/InlineSettingsFields";
import type { SettingsView } from "../components/shared/SettingsFields";

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

// A service URL → a bare host:port upstream for the assign form (Caddy dials it). "" when
// the URL is unset or has no explicit port (the user fills it in).
function urlToUpstream(url?: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return "";
  }
}

type AssignTarget = { name: string; prefix: string; upstream: string };

// The Network tab: the infrastructure services Loskai works with — the WireGuard gateway,
// AdGuard (DNS), and Caddy (TLS + the CA-onboarding page). Each panel shows health, a
// link-out, its config, an "Assign URL" (external instance), and (Caddy) the cert link.
export function Network() {
  const qc = useQueryClient();
  const health = useHealth();
  const h = health.data;
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsView>("/api/settings"),
  });
  const s = settings.data;

  const [assignFor, setAssignFor] = useState<AssignTarget | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const baseDomain = s?.base_domain?.value ?? null;
  const mode = h?.caddy?.mode ?? null;

  // AdGuard's answer IP *is* the Caddy host IP; the cert page is served there over plain
  // HTTP on :80 (prod-shaped). Strip any stray scheme/port so we never emit `http://http://…`.
  // For a shareable HTTPS name, assign a setup.<domain> instance (the Caddy panel's Assign).
  const caddyHost = (h?.adguard?.answer_ip ?? "")
    .replace(/^\w+:\/\//, "")
    .split("/")[0]
    .split(":")[0];
  const certUrl = caddyHost ? `http://${caddyHost}/` : null;

  const assign = useMutation({
    mutationFn: (p: { prefix: string; upstream: string; upstream_tls: boolean }) =>
      api.post("/api/assign", { ...p, name: assignFor?.name }),
    onSuccess: () => {
      setAssignFor(null);
      qc.invalidateQueries({ queryKey: ["caddy-routes"] });
      qc.invalidateQueries({ queryKey: ["adguard-status"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => setAssignError(err instanceof ApiError ? err.message : "Assign failed"),
  });

  const openAssign = (target: AssignTarget) => {
    setAssignError(null);
    setAssignFor(target);
  };

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
          <InlineSettingsFields fields={GATEWAY_FIELDS} />
          <AssignRow
            onClick={() =>
              openAssign({
                name: "Gateway",
                prefix: "wg",
                upstream: urlToUpstream(s?.wireguard_dashboard_url?.value),
              })
            }
          />
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
          <InlineSettingsFields fields={ADGUARD_FIELDS} />
          <AssignRow
            onClick={() =>
              openAssign({
                name: "AdGuard",
                prefix: "adguard",
                upstream: urlToUpstream(s?.adguard_url?.value),
              })
            }
          />
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
          <InlineSettingsFields fields={CADDY_FIELDS} />
          <div className="mt-4 space-y-2 border-t border-slate-800 pt-4">
            <p className="text-xs text-slate-400">
              Install Caddy's root CA on a LAN device once and every{" "}
              <span className="font-mono text-slate-300">*.domain</span> name is trusted.
              Share the by-IP link, or assign it a name:
            </p>
            <CopyLink url={certUrl} />
            <AssignRow
              label="Assign a name"
              onClick={() =>
                openAssign({
                  name: "Certificate page",
                  prefix: "setup",
                  upstream: caddyHost ? `${caddyHost}:80` : "",
                })
              }
            />
          </div>
        </ServicePanel>
      </div>

      <AssignModal
        key={assignFor?.name ?? "none"}
        open={assignFor !== null}
        baseDomain={baseDomain}
        mode={mode}
        pending={assign.isPending}
        error={assignError}
        initialPrefix={assignFor?.prefix ?? ""}
        initialUpstream={assignFor?.upstream ?? ""}
        onSubmit={(p) => assign.mutate(p)}
        onClose={() => setAssignFor(null)}
      />
    </div>
  );
}

function AssignRow({ onClick, label = "Assign URL" }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
    >
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
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
