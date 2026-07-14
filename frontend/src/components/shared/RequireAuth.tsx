import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuthStatus } from "../../lib/useAuth";

// UX-only guard: redirects to /login when there's no session. The real security
// boundary is the API middleware — the whole bundle is served unauthenticated.
export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data, isLoading } = useAuthStatus();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-24 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!data?.authed) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
