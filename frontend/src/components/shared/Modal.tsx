import type { ReactNode } from "react";
import { X } from "lucide-react";

import { useEscape } from "../../lib/useEscape";
import { useScrollLock } from "../../lib/useScrollLock";

// A short dialog's panel: a confirmation, a password, a small form.
const PANEL = "w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl";

// What every dialog stands on: the backdrop, which closes it when clicked, the page frozen
// behind it, and Escape closing the one opened last. Mount it to open the dialog.
export function Overlay({
  onClose,
  label,
  className = PANEL,
  children,
}: {
  onClose: () => void;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  useScrollLock(true);
  useEscape(true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} className={className} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// The larger dialogs (logs, terminal, stack editor, wizard): a title bar, and a body that
// scrolls. On a phone they grow to the whole screen when their content is long.
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  narrow = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  narrow?: boolean; // a short prompt — a password, say
}) {
  return (
    <Overlay
      onClose={onClose}
      label={typeof title === "string" ? title : undefined}
      className={`flex max-h-full w-full flex-col sm:max-h-[85vh] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl ${
        wide ? "max-w-4xl" : narrow ? "max-w-md" : "max-w-2xl"
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
        <div className="text-sm font-semibold text-slate-100">{title}</div>
        <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-5">{children}</div>
    </Overlay>
  );
}
