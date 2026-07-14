import { AlertTriangle, PlugZap, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";

import type { ModuleHealth } from "../../lib/useHealth";

// Per-module banner shown when a module is not healthy. A module going down greys out
// only its own card — never the whole page.
export function ModuleStatus({
  name,
  health,
}: {
  name: string;
  health?: ModuleHealth;
}) {
  if (!health || health.status === "healthy") return null;

  if (health.status === "unconfigured") {
    return (
      <Banner tone="slate" icon={<Settings2 className="h-4 w-4" />}>
        {name} is not configured.{" "}
        <Link to="/settings" className="underline underline-offset-2 hover:text-slate-200">
          Set it up
        </Link>
        .
      </Banner>
    );
  }

  const tone = health.status === "degraded" ? "amber" : "rose";
  const icon =
    health.status === "degraded" ? (
      <AlertTriangle className="h-4 w-4" />
    ) : (
      <PlugZap className="h-4 w-4" />
    );
  const verb = health.status === "degraded" ? "is degraded" : "is unreachable";
  return (
    <Banner tone={tone} icon={icon}>
      {name} {verb}
      {health.detail ? ` — ${health.detail}` : ""}.
    </Banner>
  );
}

const TONES: Record<string, string> = {
  slate: "border-slate-700 bg-slate-800/50 text-slate-300",
  amber: "border-amber-600/40 bg-amber-500/10 text-amber-200",
  rose: "border-rose-600/40 bg-rose-500/10 text-rose-200",
};

function Banner({
  tone,
  icon,
  children,
}: {
  tone: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${TONES[tone]}`}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}
