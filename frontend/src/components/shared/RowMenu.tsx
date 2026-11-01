import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

export interface RowMenuItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  hint?: string; // a muted second part, after the label
}

// A row's less-used actions behind one "⋯" button — or behind `trigger`, a labelled button
// in `triggerClass`; `onOpenChange` hears it open and close. The list is fixed-positioned from the button rather than absolute:
// tables sit in `overflow-x-auto` boxes, which would clip it. Any click outside, Escape or a
// scroll closes it.
export function RowMenu({
  label,
  items,
  trigger,
  triggerClass,
  onOpenChange,
}: {
  label: string;
  items: RowMenuItem[];
  trigger?: React.ReactNode;
  triggerClass?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const isOpen = Boolean(at);

  useEffect(() => onOpenChange?.(isOpen), [isOpen, onOpenChange]);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [at]);

  function open() {
    const r = button.current!.getBoundingClientRect();
    setAt({ top: r.bottom + 4, right: window.innerWidth - r.right });
  }

  return (
    <>
      <button
        ref={button}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        onClick={() => (at ? setAt(null) : open())}
        className={trigger ? triggerClass : "rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"}
      >
        {trigger ?? <MoreHorizontal className="h-3.5 w-3.5" />}
      </button>
      {at && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAt(null)} />
          <div
            role="menu"
            style={{ top: at.top, right: at.right }}
            className="fixed z-50 min-w-36 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl"
          >
            {items.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                onClick={() => {
                  setAt(null);
                  item.onClick();
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                  item.danger
                    ? "text-rose-300 hover:bg-rose-500/10"
                    : "text-slate-200 hover:bg-slate-800"
                }`}
              >
                {item.icon}
                {item.label}
                {item.hint && <span className="ml-auto pl-4 text-slate-500">{item.hint}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
