import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, Pin, X } from "lucide-react";

import { useEscape } from "../../lib/useEscape";

export type QuickPhase = "preparing" | "running" | "done" | "failed";

// How long a run that went well stays, so what it did can be glimpsed.
export const LINGER_MS = 3000;

const STATUS: Record<QuickPhase, string> = {
  preparing: "Getting ready…",
  running: "Running…",
  done: "Done",
  failed: "Failed",
};

// A run that does one thing and ends — an automatic action — drops down from the top of the
// page instead of opening a dialog: the page stays usable under it. Done, it stays for
// LINGER_MS, with a bar emptying, and slides back up; hovering holds it, Keep open keeps it.
// Failed, it stays until closed. The bar's animation is the timer, so pausing one pauses both.
export function QuickTerminal({
  title,
  phase,
  detail,
  onClose,
  children,
}: {
  title: string;
  phase: QuickPhase;
  // Beside the status: an exit code, or what went wrong before it ran.
  detail?: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const [held, setHeld] = useState(false);
  const [kept, setKept] = useState(false);
  const closing = useRef(false);

  // Mounted above the page, then slid in.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const leave = () => {
    if (closing.current) return;
    closing.current = true;
    setShown(false);
    setTimeout(onClose, 200);
  };
  useEscape(true, leave);

  const lingering = phase === "done" && !kept;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-2 sm:px-4">
      <section
        aria-label={title}
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        className={`pointer-events-auto w-full max-w-4xl overflow-hidden rounded-b-xl border border-t-0 border-slate-700 bg-slate-900 shadow-2xl transition-transform duration-200 motion-reduce:transition-none ${
          shown ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        <header className="flex items-center gap-2 px-4 py-2 text-sm">
          {phase === "done" ? (
            <Check className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : phase === "failed" ? (
            <X className="h-4 w-4 shrink-0 text-rose-400" />
          ) : (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
          )}
          <span className="min-w-0 truncate font-medium text-slate-100">{title}</span>
          <span className={`shrink-0 text-xs ${phase === "failed" ? "text-rose-300" : "text-slate-500"}`}>
            {STATUS[phase]}
            {detail && ` — ${detail}`}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {lingering && (
              <button
                onClick={() => setKept(true)}
                title="Keep it open"
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <Pin className="h-3.5 w-3.5" /> Keep open
              </button>
            )}
            <button onClick={leave} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-800">
              <X className="h-4 w-4" />
            </button>
          </span>
        </header>
        {lingering && (
          <div
            data-testid="linger"
            onAnimationEnd={leave}
            className="h-0.5 origin-left bg-teal-500"
            style={{
              animation: `quick-linger ${LINGER_MS}ms linear forwards`,
              animationPlayState: held ? "paused" : "running",
            }}
          />
        )}
        {children && <div className="px-3 pb-3 pt-1">{children}</div>}
      </section>
    </div>
  );
}
