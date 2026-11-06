import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

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

export interface AuthStatus {
  authed: boolean;
  needs_setup: boolean; // no account yet: first-run setup creates the admin
  user: Me | null;
}

// /api/auth/status always returns 200 (authed true/false) — the SPA uses it to choose
// login vs first-run setup, and RequireAuth uses it to gate admin routes (UX only; the
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
