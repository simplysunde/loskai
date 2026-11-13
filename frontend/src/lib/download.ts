// Saves `content` as a file the browser downloads — same-origin, from what the API answered,
// so no plain-HTTP link is needed (Chrome and Edge block those from an HTTPS page silently).
export function saveFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
