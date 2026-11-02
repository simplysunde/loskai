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
