import { afterEach, expect, test, vi } from "vitest";

import { copyText } from "./clipboard";

function context({ secure, clipboard }: { secure: boolean; clipboard?: object }) {
  Object.defineProperty(window, "isSecureContext", { value: secure, configurable: true });
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
}
function execCommand(result: boolean) {
  const fn = vi.fn(() => result);
  Object.defineProperty(document, "execCommand", { value: fn, configurable: true });
  return fn;
}

afterEach(() => vi.restoreAllMocks());

test("plain HTTP by IP has no Clipboard API, so it falls back to execCommand", async () => {
  // The regression: the Certificate page is reached exactly like this, and its copy
  // buttons threw on `navigator.clipboard.writeText` of undefined — a silent no-op.
  context({ secure: false, clipboard: undefined });
  const exec = execCommand(true);

  expect(await copyText("sudo update-ca-certificates")).toBe(true);
  expect(exec).toHaveBeenCalledWith("copy");
  expect(document.querySelector("textarea")).toBeNull(); // cleaned up
});

test("a secure context uses the Clipboard API", async () => {
  const writeText = vi.fn(async () => {});
  context({ secure: true, clipboard: { writeText } });
  const exec = execCommand(true);

  expect(await copyText("x")).toBe(true);
  expect(writeText).toHaveBeenCalledWith("x");
  expect(exec).not.toHaveBeenCalled();
});

test("a copy that fails says so, so no tick is shown", async () => {
  context({ secure: false, clipboard: undefined });
  execCommand(false);

  expect(await copyText("x")).toBe(false);
});
