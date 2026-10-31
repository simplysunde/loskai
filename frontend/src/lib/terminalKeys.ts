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
