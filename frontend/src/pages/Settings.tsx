import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";

import { api, ApiError } from "../lib/api";
import { SettingsFields, type FieldDef } from "../components/shared/SettingsFields";

// App-wide settings. Per-service config (AdGuard, Gateway, Caddy URLs/credentials) lives
// in the Network tab; this page keeps the app-level knobs + backup.
const APP_FIELDS: FieldDef[] = [
  { key: "base_domain", label: "Base Domain", hint: "e.g. example.no" },
  { key: "recipes_repo_url", label: "Recipes Repo URL" },
  { key: "stacks_dir", label: "Stacks Directory", hint: "set in the compose file" },
];

export function Settings() {
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
    onError: (err) => setError(err instanceof ApiError ? err.message : "Export failed"),
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          App-wide settings. Service URLs and credentials live in the Network tab. Env-set
          values are read-only.
        </p>
      </header>

      <div className="max-w-xl space-y-8">
        <SettingsFields fields={APP_FIELDS} />

        <section className="border-t border-slate-800 pt-6">
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
          {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
        </section>
      </div>
    </div>
  );
}
