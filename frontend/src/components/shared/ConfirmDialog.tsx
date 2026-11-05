import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { useEscape } from "../../lib/useEscape";
import { useScrollLock } from "../../lib/useScrollLock";

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  destructive = false,
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  // The confirmed request in flight (Confirm can't be pressed twice), and why it failed —
  // the dialog stays open on a failure, so it is where the reason goes.
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useScrollLock(open);
  useEscape(open, onCancel);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        <div className="mt-2 text-sm text-slate-400">{children}</div>
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              destructive
                ? "bg-rose-600 text-white hover:bg-rose-500"
                : "bg-teal-600 text-white hover:bg-teal-500"
            }`}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
