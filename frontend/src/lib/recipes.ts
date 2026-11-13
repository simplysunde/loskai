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
