import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Route, Routes } from "react-router-dom";

import { Layout } from "./components/shared/Layout";
import { useAuthStatus } from "./lib/useAuth";
import { useLook } from "./lib/useLook";
import { RequireAuth } from "./components/shared/RequireAuth";
import { Certificate } from "./pages/Certificate";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Setup } from "./pages/Setup";
import { NotFound } from "./pages/NotFound";
import { Routing } from "./pages/Routing";
import { General } from "./pages/settings/General";
import { Logs } from "./pages/settings/Logs";
import { Network } from "./pages/settings/Network";
import { Security } from "./pages/settings/Security";
import { SettingsLayout } from "./pages/settings/SettingsLayout";
import { Ssh } from "./pages/settings/Ssh";
import { Users } from "./pages/settings/Users";

// The Docker and Machines pages pull in xterm (~half the bundle). Load each only when its
// tab is opened so the initial JS chunk stays small.
const Docker = lazy(() =>
  import("./pages/Docker").then((m) => ({ default: m.Docker }))
);
const Machines = lazy(() =>
  import("./pages/Machines").then((m) => ({ default: m.Machines }))
);

function PageFallback() {
  return (
    <div className="flex justify-center py-24 text-slate-500">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

// Public: / (Dashboard), /certificate + /login. Admin tabs sit behind RequireAuth (UX) — the API
// middleware is the real gate. /settings nests its categories as child routes, so the
// guard wraps the shell once rather than each category. The catch-all is inside
// <Layout/> so a mistyped URL keeps the nav instead of rendering an empty pane.
export default function App() {
  useLook();
  // No account yet: whatever the address, the one thing to do is set Loskai up.
  const { data } = useAuthStatus();
  if (data?.needs_setup) return <Setup fields={data.setup ?? {}} />;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        {/* Public on purpose: a device that doesn't trust the internal CA yet reaches
            this by IP over plain HTTP, with no login, to fix exactly that. */}
        <Route path="/certificate" element={<Certificate />} />
        <Route
          path="/docker"
          element={
            <RequireAuth tab="docker">
              <Suspense fallback={<PageFallback />}>
                <Docker />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/routing"
          element={
            <RequireAuth tab="routing">
              <Routing />
            </RequireAuth>
          }
        />
        <Route
          path="/machines"
          element={
            <RequireAuth tab="machines">
              <Suspense fallback={<PageFallback />}>
                <Machines />
              </Suspense>
            </RequireAuth>
          }
        />
        {/* A machine opens as a dialog over the list: /machines/<id>/<category>. */}
        <Route
          path="/machines/:id/:section?"
          element={
            <RequireAuth tab="machines">
              <Suspense fallback={<PageFallback />}>
                <Machines />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth tab="admin">
              <SettingsLayout />
            </RequireAuth>
          }
        >
          <Route index element={<General />} />
          <Route path="network" element={<Network />} />
          <Route path="ssh" element={<Ssh />} />
          <Route path="users" element={<Users />} />
          <Route path="security" element={<Security />} />
          <Route path="logs" element={<Logs />} />
        </Route>
        {/* Unmatched paths keep the chrome — the pane says what went wrong. */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
