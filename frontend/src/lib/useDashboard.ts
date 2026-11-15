import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import type { Look } from "./theme";
import type { DashboardCard } from "../components/shared/ServiceCard";

// Where the Certificate page is advertised. Visibility only — the page and its download
// stay public in every mode, because a root CA is public material (backend
// `shared/settings.certificate_tab`).
export type CertificateTab = "public" | "admin" | "hidden";

export interface DashboardView {
  services: DashboardCard[];
  certificate_tab: CertificateTab;
  // The whole Loskai's look (backend `ui_look`), applied by useLook.
  ui_look: Look;
}

// /api/dashboard is the only payload a logged-out visitor can read, so it carries both
// the launcher cards and the shell's public config (the Certificate link, the look). Two components share
// the ["dashboard"] key — the page and the sidebar — so the type lives here (same
// reasoning as SettingsView in ./settings).
export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardView>("/api/dashboard"),
  });
}
