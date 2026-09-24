export type Scheme = "https" | "both" | "http";

const OPTIONS: { id: Scheme; label: string; hint: string }[] = [
  { id: "https", label: "HTTPS", hint: "Normal. Requires the device to trust the internal CA." },
  { id: "both", label: "Both", hint: "Served on 443 and 80 — the migration/mixed-fleet option." },
  { id: "http", label: "HTTP", hint: "Plain :80 only. No certificate is issued for this name." },
];

// Exists for clients that *cannot hold a custom root CA* — TVs, Chromecast/DLNA, printers,
// other containers calling the service by name, scripts. Deliberately not sold as a speed
// option: TLS on a LAN is unmeasurable next to the proxy hop, which is paid either way.
export function SchemeSelect({
  value,
  onChange,
}: {
  value: Scheme;
  onChange: (next: Scheme) => void;
}) {
  return (
    <div className="mt-3">
      <span className="mb-1 block text-xs font-medium text-slate-400">Served over</span>
      <div className="flex gap-1 rounded-lg border border-slate-800 p-1">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            title={o.hint}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
              value === o.id
                ? "bg-teal-500/15 text-teal-200"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="mt-1 block text-xs text-slate-500">
        {value === "https"
          ? "For anything that can install the certificate."
          : "For devices that can't hold a custom root CA — TVs, printers, other containers."}
      </span>
    </div>
  );
}
