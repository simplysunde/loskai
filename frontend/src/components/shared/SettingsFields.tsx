import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";

import { api, ApiError } from "../../lib/api";

export interface SettingField {
  value: string | null;
  source: "env" | "stored" | "unset";
  secret: boolean;
}
export type SettingsView = Record<string, SettingField>;

export interface FieldDef {
  key: string;
  label: string;
  hint?: string;
}

// A self-contained editable form for a subset of settings keys. Reads the shared
// /api/settings query and saves only its own keys (partial PUT), so several instances
// can coexist on one page. Env-sourced values are read-only.
export function SettingsFields({
  fields,
  saveLabel = "Save",
}: {
  fields: FieldDef[];
  saveLabel?: string;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsView>("/api/settings"),
  });

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [seeded, setSeeded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed edits once (not on every refetch) so a sibling panel's save doesn't wipe
  // in-progress input here.
  useEffect(() => {
    if (!data || seeded) return;
    const seed: Record<string, string> = {};
    for (const { key } of fields) {
      if (data[key]?.source !== "env") seed[key] = data[key]?.value ?? "";
    }
    setEdits(seed);
    setSeeded(true);
  }, [data, seeded, fields]);

  const save = useMutation({
    mutationFn: (payload: Record<string, string>) =>
      api.put<SettingsView>("/api/settings", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["health"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to save"),
  });

  if (!data) return null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const payload: Record<string, string> = {};
        for (const { key } of fields) {
          if (data[key]?.source !== "env") payload[key] = edits[key] ?? "";
        }
        save.mutate(payload);
      }}
      className="space-y-3"
    >
      {fields.map(({ key, label, hint }) => {
        const field = data[key];
        const isEnv = field?.source === "env";
        return (
          <label key={key} className="block">
            <span className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400">
              {label}
              {isEnv && (
                <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                  <Lock className="h-3 w-3" /> env
                </span>
              )}
            </span>
            <input
              type={field?.secret ? "password" : "text"}
              disabled={isEnv}
              value={isEnv ? (field?.value ?? "") : (edits[key] ?? "")}
              placeholder={hint}
              onChange={(e) => setEdits((p) => ({ ...p, [key]: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500 disabled:cursor-not-allowed disabled:text-slate-500"
            />
          </label>
        );
      })}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {saveLabel}
        </button>
        {saved && <span className="text-sm text-emerald-400">Saved</span>}
        {error && <span className="text-sm text-rose-400">{error}</span>}
      </div>
    </form>
  );
}
