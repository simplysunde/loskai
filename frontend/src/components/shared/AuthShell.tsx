import { Anchor } from "lucide-react";

import { INPUT } from "../../lib/ui";

// The page before the app: one card under Loskai's mark — logging in, and first-run setup.
// Login's sits in the middle of the screen: `my-auto` rather than centring the flex line, so
// a card taller than a phone's screen starts at the top and scrolls instead of losing its
// head. Setup's (`wide`) hangs from the top: it grows when a tick opens more fields, and a
// centred card would jump up under the pointer.
export function AuthShell({
  title,
  lead,
  wide = false,
  children,
}: {
  title: string;
  lead: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-950 p-4">
      <div
        className={`w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl ${wide ? "max-w-md sm:my-12" : "my-auto max-w-sm"}`}
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-teal-500/15 text-teal-300">
            <Anchor className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{lead}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthField({
  label,
  type = "text",
  value,
  onChange,
  autoFocus,
  autoComplete,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </label>
  );
}
