import type { ReactNode } from "react";
import { FileCode, ListChecks, Loader2 } from "lucide-react";

export function EditorFooter({
  left,
  error,
  output,
  busy,
  disabled,
  label,
  onCancel,
  onSave,
}: {
  left?: ReactNode;
  error: string | null;
  output: string | null;
  busy: boolean;
  disabled: boolean;
  label: string;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {output && (
        <pre className="max-h-40 overflow-auto rounded-lg border border-rose-900/60 bg-slate-950 px-3 py-2 font-mono text-xs text-rose-300">
          {output}
        </pre>
      )}
      <div className="flex items-center justify-between gap-2">
        <div>{left}</div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={busy || disabled}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {label}
          </button>
        </div>
      </div>
    </>
  );
}

// Switches between the form and the text files, carrying unsaved changes both ways —
// `blocked` says why it can't, when it can't.
export function SwitchView({ to, onClick, blocked }: { to: string; onClick: () => void; blocked?: string | null }) {
  return (
    <button
      onClick={onClick}
      disabled={!!blocked}
      title={blocked ?? undefined}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:hover:bg-transparent"
    >
      {to === "Edit as text" ? <FileCode className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
      {to}
    </button>
  );
}
