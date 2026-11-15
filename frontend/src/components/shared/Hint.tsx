import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useEscape } from "../../lib/useEscape";

// What a hint's box may be wide: `max-w-72`, and the clamp that keeps it on the screen.
const WIDTH = 288;

// A word with more to say: underlined with dots, its text in a small box on hover — or on a
// tap, since a phone has no hover and never shows a native `title`. The box is fixed and
// portalled like RunningPill's card, so a dialog or a sideways-scrolling table can't clip
// it. A tap (or a click) pins it open; a tap outside, Escape or a scroll closes it.
// Never inside a <label>: a label names the first button in it, so the field beside it would
// lose its name — and the hint its own.
// `className` adds to the word's own classes — `min-w-0 truncate` for an address that may be
// cut off.
export function Hint({
  text,
  children,
  className = "",
}: {
  text: string;
  children: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<React.CSSProperties | null>(null);
  const [pinned, setPinned] = useState(false);
  const close = () => {
    setAt(null);
    setPinned(false);
  };
  useEscape(at !== null, close);

  useEffect(() => {
    if (!at) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (trigger.current?.contains(t) || box.current?.contains(t)) return;
      setAt(null);
      setPinned(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("scroll", away, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("scroll", away, true);
    };
  }, [at]);

  function show() {
    const r = trigger.current!.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    // Below the word, or above it when it sits low on the screen.
    setAt(
      r.bottom + 120 > window.innerHeight
        ? { left, bottom: window.innerHeight - r.top + 6 }
        : { left, top: r.bottom + 6 },
    );
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-expanded={at !== null}
        aria-describedby={at ? id : undefined}
        onPointerEnter={(e) => e.pointerType === "mouse" && !at && show()}
        onPointerLeave={(e) => e.pointerType === "mouse" && !pinned && setAt(null)}
        onClick={() => {
          if (pinned) return close();
          if (!at) show();
          setPinned(true);
        }}
        // A button resets text-transform; the word keeps its heading's (uppercase).
        className={`cursor-help underline decoration-slate-500 decoration-dotted underline-offset-4 [text-transform:inherit] hover:decoration-slate-300 ${className}`}
      >
        {children}
      </button>
      {at &&
        createPortal(
          <div
            ref={box}
            id={id}
            role="tooltip"
            style={at}
            className="fixed z-50 w-max max-w-72 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-normal text-slate-300 shadow-2xl"
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
