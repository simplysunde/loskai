import { KeyRound, Network as NetworkIcon, ScrollText, SlidersHorizontal, Terminal, Users as UsersIcon } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

// The Settings shell — an admin's: a nested category sidebar + the content pane. Each
// category is a real route (/settings, /settings/network, /settings/ssh, /settings/users,
// /settings/security, /settings/logs) so it can be linked to
// directly — the Routing status pills deep-link to /settings/network, ModuleStatus to
// /settings (its unconfigured case is stacks_dir, under General).
const CATEGORIES = [
  { to: "/settings", label: "General", icon: SlidersHorizontal, end: true },
  { to: "/settings/network", label: "Network", icon: NetworkIcon, end: false },
  { to: "/settings/ssh", label: "SSH", icon: Terminal, end: false },
  { to: "/settings/users", label: "Users", icon: UsersIcon, end: false },
  { to: "/settings/security", label: "Security", icon: KeyRound, end: false },
  { to: "/settings/logs", label: "Logs", icon: ScrollText, end: false },
] as const;

export function SettingsLayout() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Values set by environment variables are read-only here — change them in the compose
          file.
        </p>
      </header>

      <div className="flex flex-col gap-8 sm:flex-row">
        <nav className="shrink-0 space-y-0.5 sm:w-44">
          {CATEGORIES.map(({ to, label, icon: Icon, end }) => (
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
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
