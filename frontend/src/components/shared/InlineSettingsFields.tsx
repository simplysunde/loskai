import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Lock } from "lucide-react";

import { api } from "../../lib/api";
import { useSettings, type FieldDef, type SettingField } from "../../lib/settings";
import { INPUT } from "../../lib/ui";
import { useAutoSave } from "../../lib/useAutoSave";

const FIELD_CLASS = `${INPUT} disabled:cursor-not-allowed disabled:text-slate-500`;

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
  const { state, error, inputProps, run, setDraft } = useAutoSave(
    current,
    async (val: string) => {
      await api.put("/api/settings", { [def.key]: val });
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["health"] });
      // The public payload carries settings too (the Certificate link, the look).
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    { failed: "Failed to save" },
  );

  // A select has no blur-to-commit worth having: picking an option *is* the edit, and
  // there's no half-typed state to protect, so it saves straight away — and shows the
  // stored value again when the save is refused.
  const choose = (val: string) => {
    setDraft(val);
    if (val !== current) void run(val).then((saved) => saved || setDraft(current));
  };

  return (
    <div>
      <label className="block">
        <span className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400">
          {def.label}
          {isEnv && (
            <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
              <Lock className="h-3 w-3" /> env
            </span>
          )}
          {state === "saving" && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
          {state === "saved" && <Check className="h-3 w-3 text-emerald-400" />}
        </span>
        {def.options ? (
          <select
            disabled={isEnv}
            value={isEnv ? current : inputProps.value}
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
            {...inputProps}
            value={isEnv ? current : inputProps.value}
            placeholder={def.hint}
            className={FIELD_CLASS}
          />
        )}
        {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
      </label>
      {/* Outside the label: a link inside one would also focus its input. */}
      {def.below}
    </div>
  );
}
