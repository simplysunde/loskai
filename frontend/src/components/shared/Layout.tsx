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
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Route as RouteIcon,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";

import { api, apiMessage } from "../../lib/api";
import { levelName, useAuthStatus, useMe, type Tab } from "../../lib/useAuth";
import { ChangePassword } from "./ChangePassword";
import { RowMenu } from "./RowMenu";
import { useDashboard } from "../../lib/useDashboard";
import { navDots } from "../../lib/navDots";
import { useHealth, type ModuleState } from "../../lib/useHealth";
import { getTheme, setTheme, type Theme } from "../../lib/theme";
import { UnlockPrompt } from "./UnlockPrompt";

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

// Narrowed to its icons, as this browser last left it — a convenience, so storage that
// can't be read or written leaves it wide.
const SLIM_KEY = "loskai-sidebar";
function storedSlim(): boolean {
  try {
    return localStorage.getItem(SLIM_KEY) === "slim";
  } catch {
    return false;
  }
}
function storeSlim(slim: boolean) {
  try {
    if (slim) localStorage.setItem(SLIM_KEY, "slim");
    else localStorage.removeItem(SLIM_KEY);
  } catch {
    // Not kept past this page, then.
  }
}

const DOT: Record<ModuleState, string> = {
  healthy: "bg-emerald-400",
  degraded: "bg-amber-400",
  unreachable: "bg-rose-400",
  unconfigured: "bg-slate-600",
};

// The persistent left-sidebar shell (Lutris-inspired): brand, nav, and a main content
// area rendered via <Outlet/>. Always visible — the API is the real gate, so showing
// admin links to a logged-out visitor just prompts login on click. On a phone it is a
// drawer, opened from a bar at the top, so the page gets the whole width. On a wider screen
// it narrows to its icons (`slim`), each named in its tooltip; the drawer is always wide.
export function Layout() {
  const { data: auth } = useAuthStatus();
  const authed = !!auth?.authed;
  const health = useHealth(authed);
  const { data: dash } = useDashboard();
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [changingPassword, setChangingPassword] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(storedSlim);
  // Only while the drawer is shut: on a phone the sidebar is then hidden anyway.
  const slim = collapsed && !drawer;
  const toggleSlim = () => {
    storeSlim(!collapsed);
    setCollapsed(!collapsed);
  };
  const { me, may } = useMe();
  // An operator sees the tabs it was given; Settings is an admin's. A logged-out visitor
  // still sees them all — clicking one asks them to log in.
  const mayOpen = (tab?: Tab | "admin") => !tab || !me || may(tab);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  // Certificate is the one tab whose presence is configurable (Settings). Undecided until the payload lands —
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
      setLogoutError(apiMessage(err, "Couldn't reach Loskai"));
      return;
    }
    // A fresh load of the Dashboard. Refetched in place, the page's own queries would
    // answer 401 — which sends the browser to /login — and the account's data would stay
    // in memory.
    window.location.assign("/");
  }

  return (
    // Exactly the window's height (the visible one, under a phone's browser bar): the
    // sidebar stays put and only <main> scrolls.
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-950 text-slate-200 md:flex-row">
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900/40 px-2 py-1.5 md:hidden">
        <button
          onClick={() => setDrawer(true)}
          aria-label="Menu"
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Anchor className="h-4 w-4 text-teal-300" />
        <span className="text-sm font-semibold text-slate-100">Loskai</span>
      </header>

      {drawer && <div onClick={() => setDrawer(false)} className="fixed inset-0 z-40 bg-black/60 md:hidden" />}
      <aside
        className={`${drawer ? "fixed inset-y-0 left-0 z-50 flex w-64 bg-slate-900" : "hidden"} shrink-0 flex-col border-r border-slate-800 md:static md:z-auto md:flex ${slim ? "md:w-14" : "md:w-56"} md:bg-slate-900/40`}
      >
        <div className={`flex items-center gap-2 py-5 ${slim ? "justify-center" : "px-5"}`}>
          <div title={slim ? "Loskai — homelab control" : undefined} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
            <Anchor className="h-5 w-5" />
          </div>
          {!slim && (
            <div>
              <div className="text-sm font-semibold text-slate-100">Loskai</div>
              <div className="text-[10px] text-slate-500">homelab control</div>
            </div>
          )}
        </div>

        {/* A pick closes the drawer; on a wide screen there is none to close. */}
        <nav onClick={() => setDrawer(false)} className={`flex-1 space-y-0.5 overflow-y-auto ${slim ? "px-2" : "px-3"}`}>
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={slim ? label : undefined}
              title={slim ? [label, authed && dotFor[to]?.title].filter(Boolean).join(" — ") : undefined}
              className={({ isActive }) =>
                `relative flex items-center gap-3 rounded-lg py-2 text-sm transition ${slim ? "justify-center" : "px-3"} ${
                  isActive
                    ? "bg-teal-500/10 text-teal-200"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!slim && <span className="flex-1">{label}</span>}
              {/* Slim, on the icon's corner. */}
              {authed && dotFor[to] && (
                <span
                  title={slim ? undefined : dotFor[to]!.title}
                  className={`h-1.5 w-1.5 rounded-full ${DOT[dotFor[to]!.state]} ${slim ? "absolute right-2 top-1.5" : ""}`}
                />
              )}
            </NavLink>
          ))}
        </nav>

        {/* No drawer on a wide screen: there, it narrows to its icons and back. */}
        <button
          onClick={toggleSlim}
          aria-label={slim ? "Expand the sidebar" : "Collapse the sidebar"}
          title={slim ? "Expand the sidebar" : "Collapse the sidebar to its icons"}
          className={`${FOOT(slim)} mt-3 hidden md:flex`}
        >
          {slim ? <PanelLeftOpen className="h-4 w-4 shrink-0" /> : <PanelLeftClose className="h-4 w-4 shrink-0" />}
          {!slim && "Collapse"}
        </button>

        <button
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
          title={slim ? (theme === "dark" ? "Light mode" : "Dark mode") : undefined}
          className={`${FOOT(slim)} mt-0.5 flex max-md:mt-3`}
        >
          {theme === "dark" ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
          {!slim && (theme === "dark" ? "Light mode" : "Dark mode")}
        </button>

        {/* Signed out (the Dashboard and Certificate are public): where your name would be. */}
        {auth && !authed && (
          <Link
            to="/login"
            onClick={() => setDrawer(false)}
            aria-label="Log in"
            title={slim ? "Log in" : undefined}
            className={`${FOOT(slim)} mb-3 mt-0.5 flex`}
          >
            <LogIn className="h-4 w-4 shrink-0" />
            {!slim && "Log in"}
          </Link>
        )}

        {/* You: your name opens what you do as yourself — a menu above it, like Claude's. */}
        {me && (
          <div className={`mb-3 mt-0.5 ${slim ? "mx-2" : "mx-3"}`}>
            <RowMenu
              label="Your account"
              up
              heading={`${slim ? `${me.username} · ` : ""}Level ${levelName(me.level)}`}
              triggerClass={`flex w-full items-center gap-3 rounded-lg py-2 text-left text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 ${slim ? "justify-center" : "px-3"}`}
              trigger={
                slim ? (
                  <CircleUser className="h-4 w-4 shrink-0" />
                ) : (
                  <>
                    <CircleUser className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-slate-300">{me.username}</span>
                      <span className="block text-[10px] text-slate-500">level {me.level}</span>
                    </span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  </>
                )
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
      <main data-scroll-root className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <UnlockPrompt />
    </div>
  );
}

// A button at the sidebar's foot — slim, its icon alone, centred.
const FOOT = (slim: boolean) =>
  `items-center gap-3 rounded-lg py-2 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 ${
    slim ? "mx-2 justify-center" : "mx-3 px-3"
  }`;
