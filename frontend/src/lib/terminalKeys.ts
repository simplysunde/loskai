// What a terminal key does about the clipboard: copy the selection, let the browser paste
// (xterm then sends it as one bracketed paste, so a pasted line isn't run before you see
// it), or nothing — the key goes to the shell.
export function clipboardAction(
  e: Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
  hasSelection: boolean,
): "copy" | "paste" | null {
  if (e.type !== "keydown" || !e.ctrlKey || e.altKey || e.metaKey) return null;
  const key = e.key.toLowerCase();
  if (key === "c" && (e.shiftKey || hasSelection)) return "copy";
  if (key === "v") return "paste";
  return null;
}

// The most an app may put on the clipboard in one go, as base64 — 1 MiB, far past any URL.
const OSC52_MAX = 1 << 20;

// OSC 52 — `ESC ] 52 ; <where> ; <base64> BEL` — is how a program in the terminal puts text
// on the clipboard: tmux does it when something is copied in it (`load-buffer -w`, copy
// mode), and so do Claude Code and editors over SSH. This decodes what xterm hands the
// handler (`<where>;<base64>`) to the text, or null: `?` asks to *read* the clipboard,
// which a remote machine never gets to do, and too much or not base64 is dropped.
export function decodeOsc52(data: string): string | null {
  const at = data.indexOf(";");
  if (at < 0) return null;
  const payload = data.slice(at + 1);
  if (payload === "?" || payload.length > OSC52_MAX) return null;
  try {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
