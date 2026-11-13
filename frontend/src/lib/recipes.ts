import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import type { RecipeOption } from "../components/docker/RecipeOptions";

export interface RecipeEnv {
  key: string;
  label: string;
  default?: string;
  secret?: boolean;
  // `path`: a host folder mounted into the container — the wizard says where it lands.
  type?: "text" | "path";
}
export interface Recipe {
  id: string;
  name: string;
  type: string;
  description?: string;
  env: RecipeEnv[];
  suggested_subdomain?: string;
  service?: string | null;
  // Where a link the app logs after install points (a login): the last step shows it.
  log_link?: string | null;
  // Folders the user adds at install, however many they have: each lands at
  // `target/<its name>`. Written to compose.override.yml, never into the recipe's file.
  mounts?: { label: string; target: string; read_only: boolean } | null;
  // Features switched on at install (a GPU, say), each added to the override when on.
  options?: RecipeOption[];
  // instructions.md, verbatim. Shown before the form — it is the recipe's own
  // walk-through, and the only place a recipe author can say "log in with admin/admin".
  instructions: string;
  // The recipe ships an icon.png — shown here, and given to the route at install.
  icon?: boolean;
  source: string;
  source_url?: string | null;
}
export interface RecipeList {
  recipes: Recipe[];
  invalid: { id: string; source: string; error: string }[];
  // A recipe id defined by more than one source: `source` lost, `shadowed_by` won.
  shadowed: { id: string; source: string; shadowed_by: string }[];
  // Each source's sync state, so "added a repo" and "that repo has been cloned" differ.
  sources: { url: string; label: string; enabled: boolean; builtin: boolean; synced: boolean; count: number }[];
  local_count: number;
}

// GET /api/docker/recipes: every source's recipes, merged — the wizard's catalog and the
// sources' sync state in Settings.
export function useRecipes() {
  return useQuery({
    queryKey: ["docker-recipes"],
    queryFn: () => api.get<RecipeList>("/api/docker/recipes"),
  });
}

// What POST /api/docker/recipes/refresh answers: each source's sync, one failing never
// stopping the others.
export interface SyncResult {
  ok: boolean;
  results: { url: string; label: string; ok: boolean; output: string }[];
}

// The sources that failed to sync, in a line — or null when every one synced. A failed
// source keeps what it last synced.
export function syncFailed(result: SyncResult): string | null {
  const failed = result.results.filter((r) => !r.ok);
  return failed.length ? `${failed.map((r) => r.label).join(", ")} failed — the last sync still applies.` : null;
}
