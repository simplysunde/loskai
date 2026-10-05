// Copy text, and say whether it worked. The Clipboard API exists only in a secure context,
// and Loskai is routinely reached over plain HTTP by IP — the Certificate page is reached
// that way *by design*, before the device trusts the HTTPS route. There, `navigator.clipboard`
// is undefined, so fall back to the older execCommand copy from a hidden textarea.
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or similar — the fallback below may still work.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
