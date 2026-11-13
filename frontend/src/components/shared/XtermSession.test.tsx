import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { XtermSession } from "./XtermSession";

// xterm needs a real canvas; a terminal that does nothing will do, keeping its key handler.
let keys: ((e: KeyboardEvent) => boolean) | null = null;
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    parser = { registerOscHandler: () => ({ dispose() {} }) };
    loadAddon() {}
    open() {}
    attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean) {
      keys = handler;
    }
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
      <XtermSession url="/api/ssh/machines/nas/terminal?tool=system&action=update" />
    </StrictMode>,
  );

  await vi.waitFor(() => expect(opened).toHaveLength(1));
  await new Promise((r) => setTimeout(r, 20));
  expect(opened).toEqual(["ws://localhost:3000/api/ssh/machines/nas/terminal?tool=system&action=update&cols=80&rows=24"]);
});

test("a first message goes out before anything else once the socket opens", async () => {
  const sent: unknown[] = [];
  const sockets: { onopen?: () => void; readyState: number }[] = [];
  vi.stubGlobal(
    "WebSocket",
    Object.assign(
      class {
        readyState = 0;
        onopen?: () => void;
        constructor() {
          sockets.push(this);
        }
        close() {}
        send(data: unknown) {
          sent.push(data);
        }
      },
      { OPEN: 1 },
    ),
  );

  render(<XtermSession url="/api/ssh/machines/nas/terminal?tool=system&action=update&sudo_password=true" first="TICKET" />);

  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  sockets[0].readyState = 1;
  sockets[0].onopen?.();
  expect(sent[0]).toBe("TICKET");
  expect(JSON.parse(String(sent[1]))).toMatchObject({ type: "resize" });
});

test("once the session has ended, Escape is passed on to close the dialog", async () => {
  const sockets: { onclose?: (e: { code: number; reason: string }) => void }[] = [];
  vi.stubGlobal(
    "WebSocket",
    Object.assign(
      class {
        readyState = 1;
        onclose?: (e: { code: number; reason: string }) => void;
        constructor() {
          sockets.push(this);
        }
        close() {}
        send() {}
      },
      { OPEN: 1 },
    ),
  );
  render(<XtermSession url="/api/ssh/machines/nas/terminal" />);
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  const escape = new KeyboardEvent("keydown", { key: "Escape" });

  // While the session runs, the program there gets it — vim, a menu, Claude.
  expect(keys?.(escape)).toBe(true);
  sockets[0].onclose?.({ code: 1000, reason: "" });
  expect(keys?.(escape)).toBe(false);
});
