import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

// An account: an admin does everything; an operator only its tabs.
export type Tab = "docker" | "routing" | "machines";
export interface Me {
  username: string;
  role: "admin" | "operator";
  tabs: Tab[];
}

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
    admin: me?.role === "admin",
    may: (tab: Tab | "admin") => Boolean(me && (me.role === "admin" || (tab !== "admin" && me.tabs.includes(tab)))),
  };
}

// Where a signed-in user starts: the first tab they have.
export function homeFor(me: Me | null): string {
  if (!me || me.role === "admin") return "/routing";
  const first = (["routing", "docker", "machines"] as Tab[]).find((t) => me.tabs.includes(t));
  return first ? `/${first}` : "/";
}
