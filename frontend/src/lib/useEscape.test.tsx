import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, test, vi } from "vitest";

import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { Modal } from "../components/shared/Modal";
import { InlineText } from "../components/shared/SettingRow";

test("Escape closes a dialog, as clicking outside it does", () => {
  const onClose = vi.fn();
  render(<Modal title="Logs" onClose={onClose}>body</Modal>);

  fireEvent.keyDown(screen.getByText("body"), { key: "Escape" });

  expect(onClose).toHaveBeenCalledOnce();
});

test("only the top dialog closes", () => {
  function Nested() {
    const [confirming, setConfirming] = useState(true);
    return (
      <Modal title="Edit" onClose={() => document.body.setAttribute("data-outer", "closed")}>
        <ConfirmDialog open={confirming} title="Delete it?" onConfirm={() => {}} onCancel={() => setConfirming(false)} />
      </Modal>
    );
  }
  render(<Nested />);

  fireEvent.keyDown(window, { key: "Escape" });

  expect(screen.queryByText("Delete it?")).not.toBeInTheDocument();
  expect(document.body.getAttribute("data-outer")).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.body.getAttribute("data-outer")).toBe("closed");
  document.body.removeAttribute("data-outer");
});

test("a confirm already on the page, opened from inside a dialog, closes first", () => {
  function Page() {
    const [confirming, setConfirming] = useState(false);
    return (
      <>
        <ConfirmDialog open={confirming} title="Delete it?" onConfirm={() => {}} onCancel={() => setConfirming(false)} />
        <Modal title="Edit" onClose={() => document.body.setAttribute("data-outer", "closed")}>
          <button onClick={() => setConfirming(true)}>Delete</button>
        </Modal>
      </>
    );
  }
  render(<Page />);
  fireEvent.click(screen.getByText("Delete"));

  fireEvent.keyDown(window, { key: "Escape" });

  expect(screen.queryByText("Delete it?")).not.toBeInTheDocument();
  expect(document.body.getAttribute("data-outer")).toBeNull();
});

test("in a field being edited, Escape puts it back first, and the dialog stays", () => {
  const onClose = vi.fn();
  render(
    <Modal title="Machine" onClose={onClose}>
      <InlineText label="User" value="loskai" onSave={async () => {}} />
    </Modal>,
  );
  const field = screen.getByLabelText("User");
  field.focus();
  fireEvent.change(field, { target: { value: "root" } });

  fireEvent.keyDown(field, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.keyDown(field, { key: "Escape" }); // nothing edited now
  expect(onClose).toHaveBeenCalledOnce();
});

test("an Escape something else handled — a terminal's — closes nothing", () => {
  const onClose = vi.fn();
  render(<Modal title="Terminal" onClose={onClose}>body</Modal>);

  const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  handled.preventDefault();
  window.dispatchEvent(handled);

  expect(onClose).not.toHaveBeenCalled();
});
