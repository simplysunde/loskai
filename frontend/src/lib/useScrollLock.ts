import { useEffect } from "react";

// Ref-counted, because more than one overlay can be mounted at once — a ConfirmDialog
// opened from inside a Modal is the real case (delete a stack from the stack editor). A
// per-component save/restore would let the inner one's unmount hand scrolling back while
// the outer overlay is still up.
let locks = 0;
let restore: (() => void) | null = null;

/** Freeze the page while an overlay is up, so the wheel can't scroll what's behind it.
 *
 * Pair it with `overscroll-contain` on any scrollable region *inside* the overlay: this
 * stops the page moving, that stops the gesture being handed over at all. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    if (locks === 0) {
      const { body } = document;
      const prevOverflow = body.style.overflow;
      const prevPadding = body.style.paddingRight;
      // Hiding the scrollbar gives its width back to the layout, which shifts the page
      // sideways as the dialog opens. Pad by exactly that width to hold it still.
      const gap = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = "hidden";
      if (gap > 0) body.style.paddingRight = `${gap}px`;
      restore = () => {
        body.style.overflow = prevOverflow;
        body.style.paddingRight = prevPadding;
      };
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
