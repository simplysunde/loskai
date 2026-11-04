import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";

import { ApiError } from "../../lib/api";

// One setting: its name and a line on what it does on the left, its control on the right.
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
    <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
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
  width = "w-56",
}: {
  label: string;
  value: string;
  onSave: (next: string) => Promise<unknown>;
  validate?: (next: string) => string | null;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  // Two fields share a row's right side between them: a narrower one each.
  width?: string;
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
              if (draft !== value) e.preventDefault(); // puts it back, and the dialog stays
              escaped.current = true;
              e.currentTarget.blur();
            }
          }}
          className={`${width} rounded-lg border bg-slate-950 px-2.5 py-1 text-sm text-slate-100 outline-none focus:border-teal-500 disabled:cursor-not-allowed disabled:text-slate-500 ${
            error ? "border-rose-500/60" : "border-slate-700"
          } ${mono ? "font-mono" : ""}`}
        />
      </div>
      {error && <span className="max-w-xs text-right text-xs text-rose-400">{error}</span>}
    </div>
  );
}

// An on/off setting. It only asks: what changing it does — a dialog, a terminal — is the
// caller's, and the switch moves when that has happened.
export function Switch({
  label,
  checked,
  onChange,
  disabled = false,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-teal-600" : "bg-slate-700"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}
