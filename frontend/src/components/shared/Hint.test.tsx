import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { Hint } from "./Hint";

function renderHint() {
  render(
    <>
      <span>
        <Hint text="Must be reachable from wherever Caddy runs">Host</Hint>
      </span>
      <p>elsewhere</p>
    </>,
  );
  return screen.getByRole("button", { name: "Host" });
}

test("a tap opens the box — a phone has no hover — and the next closes it", () => {
  const word = renderHint();
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

  fireEvent.click(word);
  expect(screen.getByRole("tooltip")).toHaveTextContent("Must be reachable from wherever Caddy runs");
  expect(word).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);

  fireEvent.click(word);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

test("a tap outside or Escape closes it", () => {
  const word = renderHint();
  fireEvent.click(word);
  fireEvent.pointerDown(screen.getByText("elsewhere"));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

  fireEvent.click(word);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});
