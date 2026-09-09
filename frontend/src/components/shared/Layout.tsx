import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Anchor,
  Container,
  LayoutDashboard,
  LogOut,
  Moon,
  Route as RouteIcon,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { api } from "../../lib/api";
import { useAuthStatus } from "../../lib/useAuth";
import { useDashboard } from "../../lib/useDashboard";
import { useHealth, type ModuleState } from "../../lib/useHealth";
import { getTheme, setTheme, type Theme } from "../../lib/theme";

// `public: true` marks a tab a logged-out visitor is meant to see. It is also what
// scripts/check-docs.sh subtracts before comparing this list to CLAUDE.md's admin tabs —
// add a tab without it and the docs check will ask you to call it an admin tab.
const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, public: true },
  { to: "/docker", label: "Docker", icon: Container, end: false },
  { to: "/routing", label: "Routing", icon: RouteIcon, end: false },
  { to: "/settings", label: "Settings", icon: SettingsIcon, end: false },
  { to: "/certificate", label: "Certificate", icon: ShieldCheck, end: false, public: true },
] as const;

const DOT: Record<ModuleState, string> = {
  healthy: "bg-emerald-400",
  degraded: "bg-amber-400",
  unreachable: "bg-rose-400",
  unconfigured: "bg-slate-600",
};

// Show the worst of a set of module states (problems win) as the nav dot.
function worst(...states: (ModuleState | undefined)[]): ModuleState | undefined {
  const order: ModuleState[] = ["unreachable", "degraded", "unconfigured", "healthy"];
  for (const s of order) if (states.includes(s)) return s;
  return undefined;
}

// The persistent left-sidebar shell (Lutris-inspired): brand, nav, and a main content
// area rendered via <Outlet/>. Always visible — the API is the real gate, so showing
// admin links to a logged-out visitor just prompts login on click.
export function Layout() {
  const { data: auth } = useAuthStatus();
  const authed = !!auth?.authed;
  const health = useHealth(authed);
  const { data: dash } = useDashboard();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [theme, setThemeState] = useState<Theme>(getTheme);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  // Certificate is the one tab whose presence is configurable: an ACME deployment has no
  // internal root to install, so the link is noise. Undecided until the payload lands —
  // showing it and taking it away again reads worse than a beat of nothing. This hides
  // the *link*, never the page: /certificate stays reachable, and its download is public
  // in every mode by design.
  const certTab = dash?.certificate_tab;
  const showCert = certTab === "public" || (certTab === "admin" && authed);
  const nav = NAV.filter((item) => item.to !== "/certificate" || showCert);

  const h = health.data;
  const dotFor: Record<string, ModuleState | undefined> = {
    "/docker": h?.docker.status,
    "/routing": worst(h?.caddy.status, h?.adguard.status),
  };

  async function logout() {
    await api.post("/api/logout");
    await qc.invalidateQueries();
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-200">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900/40">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
            <Anchor className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100">Loskai</div>
            <div className="text-[10px] text-slate-500">homelab control</div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? "bg-teal-500/10 text-teal-200"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label}</span>
              {authed && dotFor[to] && (
                <span className={`h-1.5 w-1.5 rounded-full ${DOT[dotFor[to]!]}`} />
              )}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={toggleTheme}
          className="mx-3 mt-3 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>

        {authed && (
          <button
            onClick={logout}
            className="mx-3 mb-3 mt-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
