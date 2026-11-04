import { useEffect, useRef, useState } from "react";

// The overlays that are up. Escape closes only the one opened last: a ConfirmDialog opened
// from a Modal goes, the Modal stays. Counted as each opens, while rendering — a parent
// renders before its children, so of two opening together the inner one counts last
// (their effects run the other way round).
const open = new Set<{ seq: number; close: { current: () => void } }>();
let rendered = 0;

function onKeyDown(e: KeyboardEvent) {
  // Something that uses Escape itself marks it handled: an inline edit putting its value
  // back, a menu closing, a terminal — whose programs read it (xterm cancels the event).
  if (e.key !== "Escape" || e.defaultPrevented || !open.size) return;
  [...open].reduce((top, o) => (o.seq > top.seq ? o : top)).close.current();
}

/** Close an overlay on Escape, as clicking outside it does. */
export function useEscape(active: boolean, onClose: () => void) {
  const [seq, setSeq] = useState(() => (active ? ++rendered : 0));
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setSeq(++rendered);
  }
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    const entry = { seq, close };
    if (!open.size) window.addEventListener("keydown", onKeyDown);
    open.add(entry);
    return () => {
      open.delete(entry);
      if (!open.size) window.removeEventListener("keydown", onKeyDown);
    };
  }, [active, seq]);
}
