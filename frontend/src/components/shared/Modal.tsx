import type { ReactNode } from "react";
import { X } from "lucide-react";

import { useScrollLock } from "../../lib/useScrollLock";

// Generic modal shell for the larger dialogs (logs, terminal, stack editor, wizard).
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useScrollLock(true);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[85vh] w-full flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl ${
          wide ? "max-w-4xl" : "max-w-2xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <div className="text-sm font-semibold text-slate-100">{title}</div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}
