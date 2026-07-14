import { Route, Routes } from "react-router-dom";

import { Layout } from "./components/shared/Layout";
import { Placeholder } from "./components/shared/Placeholder";
import { RequireAuth } from "./components/shared/RequireAuth";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Routing } from "./pages/Routing";
import { Settings } from "./pages/Settings";

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
              <Placeholder title="Docker" note="The Docker module lands in Phase 8." />
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
          path="/vpn"
          element={
            <RequireAuth>
              <Placeholder title="VPN" note="The WireGuard module lands in Phase 5." />
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
