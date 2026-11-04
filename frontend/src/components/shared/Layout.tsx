import { useState } from "react";
import {
  Anchor,
  ChevronsUpDown,
  CircleUser,
  Container,
  KeyRound,
  LayoutDashboard,
  LogIn,
  LogOut,
  Moon,
  Route as RouteIcon,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";

import { api, ApiError } from "../../lib/api";
import { useAuthStatus, useMe, type Tab } from "../../lib/useAuth";
import { ChangePassword } from "./ChangePassword";
import { RowMenu } from "./RowMenu";
import { useDashboard } from "../../lib/useDashboard";
import { navDots } from "../../lib/navDots";
import { useHealth, type ModuleState } from "../../lib/useHealth";
import { getTheme, setTheme, type Theme } from "../../lib/theme";

// `public: true` marks a tab a logged-out visitor is meant to see. It is also what
// scripts/check-docs.sh subtracts before comparing this list to CLAUDE.md's admin tabs —
// add a tab without it and the docs check will ask you to call it an admin tab.
const NAV = [
  // The public tabs first: they are what a logged-out visitor sees.
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, public: true },
  { to: "/certificate", label: "Certificate", icon: ShieldCheck, end: false, public: true },
  // `tab`: what an account needs to see it — the tab, or "admin" (shared/access.py decides).
  { to: "/docker", label: "Docker", icon: Container, end: false, tab: "docker" },
  { to: "/routing", label: "Routing", icon: RouteIcon, end: false, tab: "routing" },
  { to: "/machines", label: "Machines", icon: Server, end: false, tab: "machines" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, end: false, tab: "admin" },
] as const;

const DOT: Record<ModuleState, string> = {
  healthy: "bg-emerald-400",
  degraded: "bg-amber-400",
  unreachable: "bg-rose-400",
  unconfigured: "bg-slate-600",
};

// The persistent left-sidebar shell (Lutris-inspired): brand, nav, and a main content
// area rendered via <Outlet/>. Always visible — the API is the real gate, so showing
// admin links to a logged-out visitor just prompts login on click.
export function Layout() {
  const { data: auth } = useAuthStatus();
  const authed = !!auth?.authed;
  const health = useHealth(authed);
  const { data: dash } = useDashboard();
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [changingPassword, setChangingPassword] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const { me, may } = useMe();
  // An operator sees the tabs it was given; Settings is an admin's. A logged-out visitor
  // still sees them all — clicking one asks them to log in.
  const mayOpen = (tab?: Tab | "admin") => !tab || !me || may(tab);

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
  const nav = NAV.filter(
    (item) => (item.to !== "/certificate" || showCert) && mayOpen("tab" in item ? item.tab : undefined),
  );

  const dotFor = health.data ? navDots(health.data) : {};

  async function logout() {
    setLogoutError(null);
    try {
      await api.post("/api/logout");
    } catch (err) {
      // Still signed in: say so, rather than a menu that closed and nothing more.
      setLogoutError(err instanceof ApiError ? err.message : "Couldn't reach Loskai");
      return;
    }
    // A fresh load of the Dashboard. Refetched in place, the page's own queries would
    // answer 401 — which sends the browser to /login — and the account's data would stay
    // in memory.
    window.location.assign("/");
  }

  return (
    // Exactly the window's height: the sidebar stays put and only <main> scrolls.
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-200">
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
                <span
                  title={dotFor[to]!.title}
                  className={`h-1.5 w-1.5 rounded-full ${DOT[dotFor[to]!.state]}`}
                />
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

        {/* Signed out (the Dashboard and Certificate are public): where your name would be. */}
        {auth && !authed && (
          <Link
            to="/login"
            className="mx-3 mb-3 mt-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
          >
            <LogIn className="h-4 w-4" /> Log in
          </Link>
        )}

        {/* You: your name opens what you do as yourself — a menu above it, like Claude's. */}
        {me && (
          <div className="mx-3 mb-3 mt-0.5">
            <RowMenu
              label="Your account"
              up
              heading={me.role === "admin" ? "Admin — every tab" : `Operator — ${NAV.filter((n) => "tab" in n && may(n.tab)).map((n) => n.label).join(", ")}`}
              triggerClass="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
              trigger={
                <>
                  <CircleUser className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-300">{me.username}</span>
                    <span className="block text-[10px] text-slate-500">{me.role === "admin" ? "admin" : "operator"}</span>
                  </span>
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                </>
              }
              items={[
                { label: "Change password", icon: <KeyRound className="h-3.5 w-3.5" />, onClick: () => setChangingPassword(true) },
                { label: "Log out", icon: <LogOut className="h-3.5 w-3.5" />, onClick: () => void logout(), title: "Signs you out on every device" },
              ]}
            />
            {logoutError && <p className="px-3 pt-1 text-xs text-rose-400">Not logged out: {logoutError}</p>}
          </div>
        )}
        {changingPassword && <ChangePassword onClose={() => setChangingPassword(false)} />}
      </aside>

      {/* The one scrolling region — useScrollLock freezes it by this attribute. */}
      <main data-scroll-root className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
