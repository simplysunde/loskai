import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Download, Loader2 } from "lucide-react";

import { api, apiMessage } from "../../lib/api";
import { useRoutes } from "../../lib/routes";
import { useSettings, type FieldDef } from "../../lib/settings";
import { useSsh } from "../../lib/ssh";
import { machineAt } from "../../components/routing/machine";
import { InlineSettingsFields } from "../../components/shared/InlineSettingsFields";
import { RecipeSources } from "../../components/settings/RecipeSources";

// App-wide knobs. Per-service config (AdGuard, WireGuard, Caddy) lives under
// Settings > Network; this category keeps the app-level settings + backup. Fields commit
// on blur/Enter — the same model as every other settings category.
const APP_FIELDS: FieldDef[] = [
  { key: "base_domain", label: "Base Domain", hint: "e.g. example.no" },
  {
    key: "host_ip",
    label: "Docker Host LAN IP",
    hint: "auto-fills container upstreams in split-LXC mode, e.g. 192.168.10.50",
  },
  {
    key: "host_tailscale_ip",
    label: "Docker Host Tailscale IP",
    hint: "optional — lets Loskai's SSH reach machines over Tailscale, e.g. 100.101.102.103",
    below: <DockerHostLink />,
  },
  { key: "stacks_dir", label: "Stacks Directory", hint: "set in the compose file" },
];

// Where the Tailscale address comes from: Tailscale on the Docker host, which Loskai installs
// like on any machine — its Tailscale tool. So this goes to that machine on the Machines tab,
// as far along as it is: to name it, to set up its SSH, or to its tools.
function DockerHostLink() {
  const settings = useSettings();
  const routes = useRoutes();
  const ssh = useSsh();
  const hostIp = settings.data?.host_ip?.value;
  if (!hostIp) return null;
  const host = machineAt(hostIp, routes.data ?? []);
  const ready = host && ssh.data?.trusted?.[host.id];
  const [to, title] = !host
    ? ["/machines", "Name the Docker host on the Machines tab and set up its SSH, then add its Tailscale tool"]
    : ready
      ? [`/machines/${host.id}/tools`, "Add its Tailscale tool and Connect — its overview then shows this address"]
      : [`/machines/${host.id}/ssh`, "Set up its SSH, then add its Tailscale tool"];
  return (
    <Link to={to} title={title} className="mt-1 inline-block text-xs text-teal-400 hover:text-teal-300 hover:underline">
      Tailscale on the Docker host →
    </Link>
  );
}

export function General() {
  const [error, setError] = useState<string | null>(null);

  // Fetch the config snapshot and trigger a browser download of it as JSON.
  const exportConfig = useMutation({
    mutationFn: () => api.get<unknown>("/api/export"),
    onSuccess: (snapshot) => {
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `loskai-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (err) => setError(apiMessage(err, "Export failed")),
  });

  return (
    <div className="max-w-xl space-y-8">
      <InlineSettingsFields fields={APP_FIELDS} />

      {/* Not an InlineSettingsFields row: `recipes_repos` is a list of repos with a
          toggle each, so it gets its own editor rather than a text box. */}
      <RecipeSources />

      <section className="border-t border-slate-800 pt-6">
        <h2 className="text-sm font-medium text-slate-300">Backup</h2>
        <p className="mt-1 text-xs text-slate-500">
          Download a JSON snapshot of your instances and AdGuard rewrites.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setError(null);
              exportConfig.mutate();
            }}
            disabled={exportConfig.isPending}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {exportConfig.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export config
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      </section>
    </div>
  );
}
