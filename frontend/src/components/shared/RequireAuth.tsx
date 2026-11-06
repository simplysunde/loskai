import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Link, Navigate, useLocation } from "react-router-dom";

import { HOME, useAuthStatus, useMe, type Tab } from "../../lib/useAuth";

// UX-only guard: redirects to /login when there's no session, and says so when the account
// lacks the page's tab (`tab`) or isn't an admin. The real security boundary is the API
// middleware — the whole bundle is served unauthenticated.
export function RequireAuth({ children, tab }: { children: ReactNode; tab?: Tab | "admin" }) {
  const location = useLocation();
  const { data, isLoading } = useAuthStatus();
  const { may } = useMe();

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

  const me = data.user;
  if (tab && me && !may(tab)) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <p className="text-sm text-slate-300">
          {tab === "admin" ? "Only an admin can open this." : "Your account's level doesn't reach this tab."}
        </p>
        <Link to={HOME} className="mt-3 inline-block text-sm text-teal-400 hover:underline">
          Go to your tabs
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
