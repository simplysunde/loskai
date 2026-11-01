import { expect, test } from "vitest";

import { clipboardAction, decodeOsc52 } from "./terminalKeys";

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

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

test("OSC 52 from tmux or an app decodes to the text, unbroken", () => {
  const url = "https://claude.ai/oauth/authorize?" + "x".repeat(440);
  // tmux sends no selection letter; apps send `c`.
  expect(decodeOsc52(`;${b64(url)}`)).toBe(url);
  expect(decodeOsc52(`c;${b64("héllo ✓")}`)).toBe("héllo ✓");
});

test("OSC 52 never reads the clipboard, and drops what isn't text", () => {
  expect(decodeOsc52("c;?")).toBeNull();
  expect(decodeOsc52("c;not base64!")).toBeNull();
  expect(decodeOsc52(`c;${btoa("\xff\xfe")}`)).toBeNull(); // not UTF-8
  expect(decodeOsc52("no separator")).toBeNull();
  expect(decodeOsc52(`c;${"A".repeat((1 << 20) + 4)}`)).toBeNull();
});
