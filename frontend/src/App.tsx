import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Route, Routes } from "react-router-dom";

import { Layout } from "./components/shared/Layout";
import { RequireAuth } from "./components/shared/RequireAuth";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Network } from "./pages/Network";
import { Routing } from "./pages/Routing";
import { Settings } from "./pages/Settings";

// The Docker page pulls in xterm (~half the bundle). Load it only when that tab is
// opened so the initial JS chunk stays small.
const Docker = lazy(() =>
  import("./pages/Docker").then((m) => ({ default: m.Docker }))
);

function PageFallback() {
  return (
    <div className="flex justify-center py-24 text-slate-500">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

// Public: / (Dashboard) + /login. Admin tabs sit behind RequireAuth (UX) — the API
// middleware is the real gate. Docker (Phase 8) and VPN (Phase 5) are placeholders.
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route
          path="/docker"
          element={
            <RequireAuth>
              <Suspense fallback={<PageFallback />}>
                <Docker />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/routing"
          element={
            <RequireAuth>
              <Routing />
            </RequireAuth>
          }
        />
        <Route
          path="/network"
          element={
            <RequireAuth>
              <Network />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <Settings />
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  );
}
