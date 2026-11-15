import { useEffect } from "react";

import { setLook } from "./theme";
import { useDashboard } from "./useDashboard";

// The look is the whole Loskai's (Settings › General, backend `ui_look`), read from the
// public dashboard payload so the login page and the Dashboard wear it too. The last one
// is kept in this browser, and main.tsx applies it before the first paint, so a reload
// doesn't flash the other look first.
export function useLook() {
  const look = useDashboard().data?.ui_look;
  useEffect(() => {
    if (look) setLook(look);
  }, [look]);
}
