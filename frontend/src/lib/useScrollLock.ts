import { useEffect } from "react";

// Ref-counted, because more than one overlay can be mounted at once — a ConfirmDialog
// opened from inside a Modal is the real case (delete a stack from the stack editor). A
// per-component save/restore would let the inner one's unmount hand scrolling back while
// the outer overlay is still up.
let locks = 0;
let restore: (() => void) | null = null;

/** Freeze the page while an overlay is up, so the wheel can't scroll what's behind it.
 *
 * Inside the app shell the page does not scroll — `<main data-scroll-root>` does, and the
 * overlays are rendered inside it, so that is what has to be frozen. The body is frozen
 * too, for a page outside the shell (login).
 *
 * Pair it with `overscroll-contain` on any scrollable region *inside* the overlay: this
 * stops the page moving, that stops the gesture being handed over at all. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    if (locks === 0) {
      const { body } = document;
      const root = document.querySelector<HTMLElement>("[data-scroll-root]");
      // Hiding a scrollbar gives its width back to the layout, which shifts the content
      // sideways as the dialog opens. Pad by exactly that width to hold it still.
      const releases = [
        freeze(body, window.innerWidth - document.documentElement.clientWidth),
        ...(root ? [freeze(root, root.offsetWidth - root.clientWidth)] : []),
      ];
      restore = () => releases.forEach((release) => release());
    }
    locks += 1;

    return () => {
      locks -= 1;
      if (locks === 0) {
        restore?.();
        restore = null;
      }
    };
  }, [active]);
}

function freeze(el: HTMLElement, gap: number): () => void {
  const prevOverflow = el.style.overflow;
  const prevPadding = el.style.paddingRight;
  el.style.overflow = "hidden";
  if (gap > 0) el.style.paddingRight = `${gap}px`;
  return () => {
    el.style.overflow = prevOverflow;
    el.style.paddingRight = prevPadding;
  };
}
