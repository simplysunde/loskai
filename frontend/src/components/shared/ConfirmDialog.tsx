import type { ReactNode } from "react";

import { useScrollLock } from "../../lib/useScrollLock";

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useScrollLock(open);

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
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              destructive
                ? "bg-rose-600 text-white hover:bg-rose-500"
                : "bg-teal-600 text-white hover:bg-teal-500"
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
