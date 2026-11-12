import { useEffect, useRef, useState, type ReactNode } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { Check, Copy, Keyboard } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { copyText } from "../../lib/clipboard";
import { clipboardAction, decodeOsc52 } from "../../lib/terminalKeys";

const KEYS_HINT =
  "Tab completes on the remote shell. Ctrl+Shift+C copies the selection (Ctrl+C too, while " +
  "text is selected — otherwise it interrupts). Ctrl+V or Ctrl+Shift+V pastes. Shift+drag " +
  "selects even where a program uses the mouse (tmux, Claude Code). What a program copies — " +
  "tmux, Claude Code's c — reaches your clipboard.";

// What a program in the terminal copied (OSC 52), and whether the browser let it through.
interface Copied {
  text: string;
  ok: boolean;
}


// An interactive shell over a WebSocket: keystrokes and pastes go out as bytes (stdin), a
// resize as a JSON control frame, output comes back as bytes. The container terminal and a
// machine's SSH terminal are both this; `toolbar` gets a function that types a command.
export function XtermSession({
  url,
  onClosed,
  onOutput,
  toolbar,
  height = "h-[55vh]",
}: {
  url: string;
  // How the server closed it — a machine's terminal reopens after the key is unlocked.
  onClosed?: (code: number, reason: string) => void;
  // What the session prints, as text — read by the quick terminal for how a run ended.
  onOutput?: (text: string) => void;
  toolbar?: (run: (command: string) => void) => ReactNode;
  height?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;
  const [copied, setCopied] = useState<Copied | null>(null);

  useEffect(() => {
    const term = new XTerm({
      fontSize: 13,
      fontFamily: "ui-monospace, monospace",
      theme: { background: "#020617", foreground: "#e2e8f0" },
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current!);
    fit.fit();

    // Once the session has ended there is no program left to read Escape, so it is passed on:
    // the dialog the terminal is in closes, as it would anywhere else.
    let ended = false;
    term.attachCustomKeyEventHandler((e) => {
      if (ended && e.key === "Escape") return false;
      const action = clipboardAction(e, term.hasSelection());
      if (action === "copy") {
        e.preventDefault();
        const text = term.getSelection();
        if (!e.shiftKey) term.clearSelection();
        // Nothing selected — a highlight drawn by the program isn't xterm's selection —
        // leaves the clipboard as it was rather than emptying it.
        if (text) void copyText(text).then(() => term.focus());
        return false;
      }
      // Not handled by xterm (which would send ^V) and not prevented, so the browser pastes
      // into xterm's own textarea, and xterm sends it on.
      return action !== "paste";
    });

    // A program copying: tmux passes on what is copied in it, Claude Code and editors send
    // their own. Without this xterm drops it, and the text never leaves the terminal. The
    // keypress that copied is usually still a user gesture, so the browser allows it; when
    // it doesn't (plain HTTP, Firefox), a button copies it on the next click.
    let clearCopied: ReturnType<typeof setTimeout> | undefined;
    const oscSub = term.parser.registerOscHandler(52, (data) => {
      const text = decodeOsc52(data);
      if (text) {
        void copyText(text).then((ok) => {
          term.focus();
          setCopied({ text, ok });
          clearTimeout(clearCopied);
          if (ok) clearCopied = setTimeout(() => setCopied(null), 4000);
        });
      }
      return true;
    });

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let ws: WebSocket | null = null;
    const sendResize = () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", rows: term.rows, cols: term.cols }));
      }
    };

    // Opened a tick later, so a mount undone at once — StrictMode's, in the dev build — opens
    // nothing. Opening is what starts the session on the server: a machine's action runs, and
    // the ticket holding its sudo password is spent, by a socket closed straight away.
    const connecting = setTimeout(() => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const sep = url.includes("?") ? "&" : "?";
      const socket = new WebSocket(
        `${proto}://${location.host}${url}${sep}cols=${term.cols}&rows=${term.rows}`,
      );
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        sendResize();
        term.focus();
      };
      socket.onmessage = (e) => {
        const data = typeof e.data === "string" ? e.data : new Uint8Array(e.data);
        term.write(data);
        if (onOutputRef.current) {
          onOutputRef.current(typeof data === "string" ? data : decoder.decode(data, { stream: true }));
        }
      };
      socket.onclose = (e) => {
        const why = e.reason ? `: ${e.reason}` : "";
        ended = true;
        term.write(`\r\n\x1b[90m[session closed${why}] Esc closes this.\x1b[0m\r\n`);
        onClosedRef.current?.(e.code, e.reason);
      };
      ws = wsRef.current = socket;
    });

    const dataSub = term.onData((d) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(encoder.encode(d));
    });
    const resizeSub = term.onResize(sendResize);
    const onWinResize = () => fit.fit();
    window.addEventListener("resize", onWinResize);

    return () => {
      window.removeEventListener("resize", onWinResize);
      dataSub.dispose();
      resizeSub.dispose();
      oscSub.dispose();
      clearTimeout(clearCopied);
      clearTimeout(connecting);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      term.dispose();
    };
  }, [url]);

  const run = (command: string) => {
    wsRef.current?.send(new TextEncoder().encode(command + "\n"));
  };

  return (
    <>
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">{toolbar?.(run)}</div>
        {copied?.ok && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-300">
            <Check className="h-3.5 w-3.5" /> Copied {copied.text.length} characters
          </span>
        )}
        {copied && !copied.ok && (
          <button
            title="The browser didn't let the terminal copy by itself — this copies it"
            onClick={() => void copyText(copied.text).then((ok) => ok && setCopied(null))}
            className="flex shrink-0 items-center gap-1 rounded-md border border-amber-500/40 px-1.5 py-0.5 text-xs text-amber-300 hover:bg-amber-500/10"
          >
            <Copy className="h-3.5 w-3.5" /> Copy {copied.text.length} characters
          </button>
        )}
        <span title={KEYS_HINT} className="shrink-0 cursor-help text-slate-500">
          <Keyboard aria-label="Keyboard shortcuts" className="h-4 w-4" />
        </span>
      </div>
      <div ref={hostRef} className={`${height} rounded-lg bg-slate-950 p-2`} />
    </>
  );
}
