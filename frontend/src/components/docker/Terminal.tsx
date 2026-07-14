import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { Modal } from "../shared/Modal";
import { QuickCommands } from "./QuickCommands";

// Interactive shell via WebSocket to /api/docker/containers/{id}/exec. Keystrokes are
// sent as binary (stdin); a resize is a JSON control frame. Output arrives as bytes.
export function Terminal({
  container,
  onClose,
}: {
  container: { id: string; name: string };
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

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

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/api/docker/containers/${container.id}/exec`,
    );
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    const encoder = new TextEncoder();

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", rows: term.rows, cols: term.cols }));
      }
    };

    ws.onopen = () => {
      sendResize();
      term.focus();
    };
    ws.onmessage = (e) => {
      term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data));
    };
    ws.onclose = () => term.write("\r\n\x1b[90m[session closed]\x1b[0m\r\n");

    const dataSub = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(d));
    });
    const resizeSub = term.onResize(sendResize);
    const onWinResize = () => fit.fit();
    window.addEventListener("resize", onWinResize);

    return () => {
      window.removeEventListener("resize", onWinResize);
      dataSub.dispose();
      resizeSub.dispose();
      ws.close();
      term.dispose();
    };
  }, [container.id]);

  const runCommand = (cmd: string) => {
    wsRef.current?.send(new TextEncoder().encode(cmd + "\n"));
  };

  return (
    <Modal title={`Terminal — ${container.name}`} onClose={onClose} wide>
      <QuickCommands containerId={container.id} onRun={runCommand} />
      <div ref={hostRef} className="h-[55vh] rounded-lg bg-slate-950 p-2" />
    </Modal>
  );
}
