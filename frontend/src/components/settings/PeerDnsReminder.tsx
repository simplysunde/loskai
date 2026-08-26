import { Info } from "lucide-react";

// Remote peers must resolve names through AdGuard — the most common WireGuard
// misconfiguration. Shows the AdGuard IP to set as peer DNS when it's known.
export function PeerDnsReminder({ dnsHint }: { dnsHint?: string | null }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
        <Info className="h-3.5 w-3.5 text-slate-400" /> Peer DNS reminder
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        So remote peers resolve names through AdGuard, set each peer's DNS to{" "}
        {dnsHint ? (
          <>
            <span className="font-mono text-teal-300">{dnsHint}</span> (AdGuard) plus{" "}
            <span className="font-mono text-slate-300">1.1.1.1</span> as a fallback.
          </>
        ) : (
          <>
            your AdGuard server's IP, plus{" "}
            <span className="font-mono text-slate-300">1.1.1.1</span> as a fallback.
          </>
        )}
      </p>
    </div>
  );
}
