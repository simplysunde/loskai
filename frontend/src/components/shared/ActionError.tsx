import { X } from "lucide-react";

// A row action that failed, above the table it came from — until dismissed or the next one.
// `detail` is what Loskai said, kept as written: compose output runs to several lines.
export function ActionError({ title, detail, onDismiss }: { title: string; detail: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-rose-600/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium">{title}</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-rose-300 hover:text-rose-100">
          <X className="h-4 w-4" />
        </button>
      </div>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-rose-300">{detail}</pre>
    </div>
  );
}
