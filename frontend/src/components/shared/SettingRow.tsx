import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";

import { ApiError } from "../../lib/api";

// One setting: its name and a line on what it does on the left, its control on the right.
// Rows sit in a `divide-y` list, so a thin line runs between them.
export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{label}</div>
        {description && <div className="mt-0.5 text-xs text-slate-500">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

// A text field that saves itself: on Enter or on leaving it, when the value changed and
// `validate` has nothing to say. Escape puts the saved value back. A spinner, then a check,
// says the save went through; what went wrong shows beneath.
export function InlineText({
  label,
  value,
  onSave,
  validate,
  placeholder,
  disabled = false,
  mono = false,
}: {
  label: string;
  value: string;
  onSave: (next: string) => Promise<unknown>;
  validate?: (next: string) => string | null;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const escaped = useRef(false);

  // A value changed elsewhere — a refetch after another row's save — shows, unless typing.
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = async () => {
    focused.current = false;
    if (escaped.current) {
      escaped.current = false;
      setDraft(value);
      setError(null);
      return;
    }
    const next = draft.trim();
    if (next === value) {
      setDraft(value);
      setError(null);
      return;
    }
    const problem = validate?.(next) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setState("saving");
    try {
      await onSave(next);
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      setState("idle");
      setError(err instanceof ApiError ? err.message : "Couldn't save it");
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {state === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
        {state === "saved" && <Check className="h-3.5 w-3.5 text-emerald-400" />}
        <input
          aria-label={label}
          value={draft}
          disabled={disabled || state === "saving"}
          placeholder={placeholder}
          onFocus={() => (focused.current = true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              escaped.current = true;
              e.currentTarget.blur();
            }
          }}
          className={`w-56 rounded-lg border bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-teal-500 disabled:cursor-not-allowed disabled:text-slate-500 ${
            error ? "border-rose-500/60" : "border-slate-700"
          } ${mono ? "font-mono" : ""}`}
        />
      </div>
      {error && <span className="max-w-xs text-right text-xs text-rose-400">{error}</span>}
    </div>
  );
}
