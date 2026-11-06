import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { XtermSession } from "./XtermSession";

// xterm needs a real canvas; a terminal that does nothing will do.
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    parser = { registerOscHandler: () => ({ dispose() {} }) };
    loadAddon() {}
    open() {}
    attachCustomKeyEventHandler() {}
    onData = () => ({ dispose() {} });
    onResize = () => ({ dispose() {} });
    hasSelection = () => false;
    write() {}
    focus() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));

test("a terminal mounted twice at once, as StrictMode does, opens one socket", async () => {
  const opened: string[] = [];
  vi.stubGlobal(
    "WebSocket",
    Object.assign(
      class {
        readyState = 0;
        constructor(url: string) {
          opened.push(url);
        }
        close() {}
        send() {}
      },
      { OPEN: 1 },
    ),
  );

  render(
    <StrictMode>
      <XtermSession url="/api/ssh/machines/nas/terminal?ticket=t" />
    </StrictMode>,
  );

  await vi.waitFor(() => expect(opened).toHaveLength(1));
  await new Promise((r) => setTimeout(r, 20));
  expect(opened).toEqual(["ws://localhost:3000/api/ssh/machines/nas/terminal?ticket=t&cols=80&rows=24"]);
});
