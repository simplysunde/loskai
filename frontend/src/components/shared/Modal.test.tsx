import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { Modal } from "./Modal";

const open = () => {
  const onClose = vi.fn();
  render(
    <Modal title="Terminal" onClose={onClose}>
      <p>inside</p>
    </Modal>,
  );
  const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
  return { onClose, backdrop, inside: screen.getByText("inside") };
};

test("a click on the backdrop closes the dialog", () => {
  const { onClose, backdrop } = open();
  fireEvent.mouseDown(backdrop);
  fireEvent.mouseUp(backdrop);
  fireEvent.click(backdrop);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a drag from inside out, or from outside in, leaves it open", () => {
  const { onClose, backdrop, inside } = open();
  // Selecting text, released past the dialog's edge: the click lands on the backdrop.
  fireEvent.mouseDown(inside);
  fireEvent.click(backdrop);
  // Pressed outside, released inside: the click lands on the backdrop too.
  fireEvent.mouseDown(backdrop);
  fireEvent.mouseUp(inside);
  fireEvent.click(backdrop, { target: backdrop });
  expect(onClose).not.toHaveBeenCalled();
});
