import type { SaveResult } from "./useSaveMachine";

// What a save did: the name, then its warning — or that it worked, and what moved with it.
export function SaveBanner({ result }: { result: SaveResult }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm ${
        result.warning
          ? "border-amber-600/40 bg-amber-500/10 text-amber-200"
          : "border-emerald-600/40 bg-emerald-500/10 text-emerald-200"
      }`}
    >
      <span className="font-medium">{result.url}</span> —{" "}
      {result.warning ??
        (result.link
          ? "link saved — on the Dashboard."
          : result.caddy === "skipped"
            ? "DNS rewrite saved."
            : "route + DNS rewrite created.")}
      {result.moved && result.moved.length > 0 && <> Moved {result.moved.join(", ")} with it.</>}
    </div>
  );
}
