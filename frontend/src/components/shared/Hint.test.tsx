import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { Hint, ReasonButton } from "./Hint";

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

test("a button off for a reason says it on a tap, and does nothing else", () => {
  const onClick = vi.fn();
  render(
    <ReasonButton reason="Not running — Start it first" title="Attach to its session" onClick={onClick}>
      Attach
    </ReasonButton>,
  );
  const button = screen.getByRole("button", { name: "Attach" });
  // aria-disabled, not disabled: a disabled button would swallow the tap too.
  expect(button).toHaveAttribute("aria-disabled", "true");
  expect(button).toBeEnabled();
  expect(button).not.toHaveAttribute("title");

  fireEvent.click(button);
  expect(screen.getByRole("tooltip")).toHaveTextContent("Not running — Start it first");
  expect(onClick).not.toHaveBeenCalled();
});

test("without a reason it is a plain button", () => {
  const onClick = vi.fn();
  render(
    <ReasonButton reason={null} title="Attach to its session" onClick={onClick}>
      Attach
    </ReasonButton>,
  );
  const button = screen.getByRole("button", { name: "Attach" });
  expect(button).not.toHaveAttribute("aria-disabled");
  expect(button).toHaveAttribute("title", "Attach to its session");

  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});
