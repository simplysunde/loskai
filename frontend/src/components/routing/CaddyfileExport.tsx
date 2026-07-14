import { useState } from "react";
import { Check, Copy, Download, FileText } from "lucide-react";

import { api, ApiError } from "../../lib/api";

// Downloads / copies the Caddyfile rendered from the instance list (GET
// /api/caddy/caddyfile, text/plain). Useful to bootstrap the co-located / all-in-one
// setups. 400 when base_domain is unset.
export function CaddyfileExport() {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setError(null);
    try {
      setText(await api.text("/api/caddy/caddyfile"));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? "Set a base domain in Settings first."
          : "Could not load the Caddyfile.",
      );
    }
  }

  function copy() {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function download() {
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "Caddyfile";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <FileText className="h-4 w-4 text-slate-400" />
          Caddyfile export
        </div>
        {text === null ? (
          <button
            onClick={load}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            Generate
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={copy}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={download}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </button>
          </div>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      {text && (
        <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-300">
          {text}
        </pre>
      )}
    </div>
  );
}
