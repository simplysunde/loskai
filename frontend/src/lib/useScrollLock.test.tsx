import { render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { useScrollLock } from "./useScrollLock";

function Overlay({ active = true }: { active?: boolean }) {
  useScrollLock(active);
  return <div>overlay</div>;
}

afterEach(() => {
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

test("the page is frozen while an overlay is up, and released after", () => {
  const { unmount } = render(<Overlay />);
  expect(document.body.style.overflow).toBe("hidden");

  unmount();
  expect(document.body.style.overflow).toBe("");
});

test("an inactive overlay leaves scrolling alone", () => {
  render(<Overlay active={false} />);
  expect(document.body.style.overflow).toBe("");
});

test("toggling active locks and releases without unmounting", () => {
  const { rerender } = render(<Overlay active={false} />);
  expect(document.body.style.overflow).toBe("");

  rerender(<Overlay active />);
  expect(document.body.style.overflow).toBe("hidden");

  rerender(<Overlay active={false} />);
  expect(document.body.style.overflow).toBe("");
});

test("a nested overlay closing does not hand scrolling back to the page", () => {
  // The real case: a ConfirmDialog opened from inside a Modal. Closing the inner one
  // must not unfreeze the page while the outer overlay is still covering it.
  const outer = render(<Overlay />);
  const inner = render(<Overlay />);
  expect(document.body.style.overflow).toBe("hidden");

  inner.unmount();
  expect(document.body.style.overflow).toBe("hidden");

  outer.unmount();
  expect(document.body.style.overflow).toBe("");
});

test("an existing body overflow is restored, not blanked", () => {
  document.body.style.overflow = "scroll";

  const { unmount } = render(<Overlay />);
  expect(document.body.style.overflow).toBe("hidden");

  unmount();
  expect(document.body.style.overflow).toBe("scroll");
});
