import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

export interface AuthStatus {
  authed: boolean;
  password_set: boolean;
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
