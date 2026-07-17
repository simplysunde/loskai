import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Pencil, Save } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import type { FieldDef, SettingField, SettingsView } from "./SettingsFields";

// Per-field inline editor: each row is read-only with a pencil, click to edit, the button
// becomes a save. Enter saves, Escape cancels. Saves one key at a time (partial PUT), so
// each field is independent. Env-sourced values stay locked.
export function InlineSettingsFields({ fields }: { fields: FieldDef[] }) {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsView>("/api/settings"),
  });
  if (!data) return null;
  return (
    <div className="space-y-3">
      {fields.map((def) => (
        <InlineField key={def.key} def={def} field={data[def.key]} />
      ))}
    </div>
  );
}

function InlineField({ def, field }: { def: FieldDef; field?: SettingField }) {
  const qc = useQueryClient();
  const isEnv = field?.source === "env";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = useMutation({
    mutationFn: () => api.put("/api/settings", { [def.key]: draft }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["health"] });
      setEditing(false);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to save"),
  });

  const startEdit = () => {
    setDraft(field?.value ?? "");
    setError(null);
    setEditing(true);
  };

  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400">
        {def.label}
        {isEnv && (
          <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            <Lock className="h-3 w-3" /> env
          </span>
        )}
      </span>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type={field?.secret ? "password" : "text"}
          disabled={!editing || isEnv}
          value={editing ? draft : (field?.value ?? "")}
          placeholder={def.hint}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save.mutate();
            } else if (e.key === "Escape") {
              setEditing(false);
              setError(null);
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500 disabled:cursor-not-allowed disabled:text-slate-500"
        />
        {!isEnv && (
          <button
            type="button"
            title={editing ? "Save" : "Edit"}
            disabled={save.isPending}
            onClick={editing ? () => save.mutate() : startEdit}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border disabled:opacity-50 ${
              editing
                ? "border-teal-600 bg-teal-600 text-white hover:bg-teal-500"
                : "border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {save.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : editing ? (
              <Save className="h-4 w-4" />
            ) : (
              <Pencil className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
    </label>
  );
}
