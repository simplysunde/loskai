import { Construction } from "lucide-react";

// Stand-in for tabs whose modules aren't built yet (Docker = Phase 8, VPN = Phase 5).
// The sidebar link works; the page says what's coming.
export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-slate-100">{title}</h1>
      <div className="mt-8 flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-800 py-16 text-center text-slate-500">
        <Construction className="h-8 w-8" />
        <p className="text-sm">{note}</p>
      </div>
    </div>
  );
}
