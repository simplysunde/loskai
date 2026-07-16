import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Lock } from "lucide-react";

import { api, ApiError } from "../lib/api";

interface SettingField {
  value: string | null;
  source: "env" | "stored" | "unset";
  secret: boolean;
}
type SettingsView = Record<string, SettingField>;

// Label + order for the settings form. stacks_dir is always env-sourced (read-only).
const FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "base_domain", label: "Base Domain", hint: "e.g. example.no" },
  { key: "caddy_admin_url", label: "Caddy Admin URL" },
  { key: "caddy_host_ip", label: "Caddy LAN IP", hint: "only if Caddy URL is a hostname" },
  { key: "adguard_url", label: "AdGuard URL" },
  { key: "adguard_user", label: "AdGuard Username" },
  { key: "adguard_password", label: "AdGuard Password" },
  { key: "wireguard_dashboard_url", label: "WireGuard Dashboard URL" },
  { key: "recipes_repo_url", label: "Recipes Repo URL" },
  { key: "stacks_dir", label: "Stacks Directory", hint: "set in the compose file" },
];

export function Settings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsView>("/api/settings"),
  });

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
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
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Export failed"),
  });

  // Seed local edits from the fetched values (stored/unset fields only).
  useEffect(() => {
    if (!data) return;
    const seed: Record<string, string> = {};
    for (const { key } of FIELDS) {
      if (data[key]?.source !== "env") seed[key] = data[key]?.value ?? "";
    }
    setEdits(seed);
  }, [data]);

  const save = useMutation({
    mutationFn: (payload: Record<string, string>) =>
      api.put<SettingsView>("/api/settings", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["health"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Failed to save"),
  });

  if (isLoading || !data) {
    return (
      <Page>
        <div className="flex justify-center py-16 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate(edits);
        }}
        className="max-w-xl space-y-4"
      >
        {FIELDS.map(({ key, label, hint }) => {
          const field = data[key];
          const isEnv = field?.source === "env";
          return (
            <label key={key} className="block">
              <span className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400">
                {label}
                {isEnv && (
                  <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                    <Lock className="h-3 w-3" /> set via environment
                  </span>
                )}
              </span>
              <input
                type={field?.secret ? "password" : "text"}
                disabled={isEnv}
                value={isEnv ? (field?.value ?? "") : (edits[key] ?? "")}
                placeholder={hint}
                onChange={(e) =>
                  setEdits((prev) => ({ ...prev, [key]: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500 disabled:cursor-not-allowed disabled:text-slate-500"
              />
            </label>
          );
        })}

        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={save.isPending}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
          {saved && <span className="text-sm text-emerald-400">Saved</span>}
        </div>
      </form>

      <section className="mt-10 max-w-xl border-t border-slate-800 pt-6">
        <h2 className="text-sm font-medium text-slate-300">Backup</h2>
        <p className="mt-1 text-xs text-slate-500">
          Download a JSON snapshot of your instances and AdGuard rewrites.
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            exportConfig.mutate();
          }}
          disabled={exportConfig.isPending}
          className="mt-3 flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          {exportConfig.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export config
        </button>
      </section>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Env-set values are read-only. Everything else is stored in the settings volume.
        </p>
      </header>
      {children}
    </div>
  );
}
