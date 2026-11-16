import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import type { SettingField } from "./settings";

// An account has a level, and each level adds to the ones below (shared/users.py); 4 is an
// admin. `tabs` are the ones its level reaches, as the API works them out.
export type Tab = "docker" | "routing" | "machines";
export type Level = 1 | 2 | 3 | 4;
export interface Me {
  username: string;
  level: Level;
  tabs: Tab[];
}

// What each level is called, and what it adds to the one below.
export const LEVELS: { level: Level; name: string; adds: string }[] = [
  { level: 1, name: "Routing", adds: "Routes and DNS names" },
  { level: 2, name: "Docker", adds: "Stacks, containers and recipe installs" },
  { level: 3, name: "Machines", adds: "Machines over SSH: terminals and tools" },
  { level: 4, name: "Settings", adds: "Settings, users and the logs — an admin" },
];

export const levelName = (level: Level) => `${level} — ${LEVELS[level - 1].name}`;

// What first-run setup asks for (backend `settings.SETUP_KEYS`), each as Settings shows a
// value: where it came from, and the value unless it is a secret.
export type SetupKey = "base_domain" | "host_ip" | "caddy_admin_url" | "adguard_url" | "adguard_user" | "adguard_password";
export type SetupFields = Partial<Record<SetupKey, SettingField>>;

export interface AuthStatus {
  authed: boolean;
  needs_setup: boolean; // no account yet: the app shows first-run setup, which makes the admin
  setup?: SetupFields; // only while needs_setup
  user: Me | null;
}

// /api/auth/status always returns 200 (authed true/false) — the SPA uses it to show
// first-run setup instead of the app, and RequireAuth uses it to gate admin routes (UX only; the
// real gate is the API middleware).
export function useAuthStatus() {
  return useQuery({
    queryKey: ["auth-status"],
    queryFn: () => api.get<AuthStatus>("/api/auth/status"),
    staleTime: 5_000,
  });
}

// Who is signed in, and what they may use — for showing only what works. The API decides
// (shared/access.py); this only keeps the page from offering what it would refuse.
export function useMe() {
  const { data } = useAuthStatus();
  const me = data?.user ?? null;
  return {
    me,
    admin: me?.level === 4,
    may: (tab: Tab | "admin") => Boolean(me && (tab === "admin" ? me.level === 4 : me.tabs.includes(tab))),
  };
}

// Where a signed-in user starts: Routing, which every level has.
export const HOME = "/routing";
