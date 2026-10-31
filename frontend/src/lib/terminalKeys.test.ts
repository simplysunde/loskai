import { expect, test } from "vitest";

import { clipboardAction } from "./terminalKeys";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  type: "keydown", key: k, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, ...mods,
});

test("Ctrl+Shift+C always copies; Ctrl+C copies only while text is selected", () => {
  expect(clipboardAction(key("C", { shiftKey: true }), false)).toBe("copy");
  expect(clipboardAction(key("c"), true)).toBe("copy");
  // Nothing selected: Ctrl+C is the shell's interrupt, as in any terminal.
  expect(clipboardAction(key("c"), false)).toBeNull();
});

test("Ctrl+V and Ctrl+Shift+V paste", () => {
  expect(clipboardAction(key("v"), false)).toBe("paste");
  expect(clipboardAction(key("V", { shiftKey: true }), false)).toBe("paste");
});

test("everything else goes to the shell — Tab included, so it completes there", () => {
  expect(clipboardAction(key("Tab", { ctrlKey: false }), false)).toBeNull();
  expect(clipboardAction(key("d"), false)).toBeNull(); // Ctrl+D: end of input
  expect(clipboardAction(key("c", { altKey: true }), true)).toBeNull();
  expect(clipboardAction({ ...key("v"), type: "keyup" }, false)).toBeNull();
});
