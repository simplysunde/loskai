import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Lock } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { useSettings, type FieldDef, type SettingField } from "../../lib/settings";

const FIELD_CLASS =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500 disabled:cursor-not-allowed disabled:text-slate-500";

// Auto-saving settings fields: each field is always editable and commits on blur / Enter
// (one key at a time, partial PUT) — no per-panel Save button. Env-sourced values stay
// locked. A subtle spinner/check by the label reports the save.
export function InlineSettingsFields({ fields }: { fields: FieldDef[] }) {
  const { data } = useSettings();
  if (!data) return null;
  return (
    <div className="space-y-3">
      {fields.map((def) => (
        <AutoField key={def.key} def={def} field={data[def.key]} />
      ))}
    </div>
  );
}

function AutoField({ def, field }: { def: FieldDef; field?: SettingField }) {
  const qc = useQueryClient();
  const isEnv = field?.source === "env";
  // An unset select shows its default rather than a blank row — the first option *is*
  // the default (backend: CERTIFICATE_TAB_DEFAULT), so keep the two in step.
  const current = field?.value ?? (def.options ? def.options[0].value : "");
  const [draft, setDraft] = useState(current);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);

  // Reflect external changes (this or a sibling save) when we're not actively editing.
  useEffect(() => {
    if (!focused.current) setDraft(current);
  }, [current]);

  const save = useMutation({
    mutationFn: (val: string) => api.put("/api/settings", { [def.key]: val }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["health"] });
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to save"),
  });

  const commit = () => {
    focused.current = false;
    if (draft === current) return; // nothing changed — no request
    save.mutate(draft);
  };

  // A select has no blur-to-commit worth having: picking an option *is* the edit, and
  // there's no half-typed state to protect, so it saves straight away.
  const choose = (val: string) => {
    setDraft(val);
    if (val !== current) save.mutate(val);
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
        {save.isPending && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
        {saved && <Check className="h-3 w-3 text-emerald-400" />}
      </span>
      {def.options ? (
        <select
          disabled={isEnv}
          value={isEnv ? current : draft}
          onChange={(e) => choose(e.target.value)}
          className={FIELD_CLASS}
        >
          {def.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field?.secret ? "password" : "text"}
          disabled={isEnv}
          value={isEnv ? current : draft}
          placeholder={def.hint}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              if (draft !== current) e.preventDefault(); // puts it back, and the dialog stays
              setDraft(current);
              e.currentTarget.blur();
            }
          }}
          className={FIELD_CLASS}
        />
      )}
      {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
    </label>
  );
}
