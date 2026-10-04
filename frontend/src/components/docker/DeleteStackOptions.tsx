import type { Stack } from "./StackList";

// What Delete on a stack will do, and the one choice it offers. Recipes keep their data
// beside the compose file (./data), so by default Delete removes only compose.yml and
// .env and leaves the rest — installing the same thing again picks it back up. Taking the
// data too is a deliberate tick, never the default.
export function DeleteStackOptions({
  stack,
  deleteData,
  onDeleteData,
}: {
  stack: Stack;
  deleteData: boolean;
  onDeleteData: (on: boolean) => void;
}) {
  const data = stack.data ?? [];
  return (
    <span className="block">
      Stops its containers and removes <span className="font-mono">compose.yml</span> and{" "}
      <span className="font-mono">.env</span> from{" "}
      <span className="font-medium text-slate-200">{stack.name}</span>.
      {data.length === 0 ? (
        <span className="mt-2 block text-slate-500">
          Nothing else is in its folder, so the folder goes too.
        </span>
      ) : (
        <>
          <label className="mt-3 flex items-start gap-2 text-slate-300">
            <input
              type="checkbox"
              checked={deleteData}
              onChange={(e) => onDeleteData(e.target.checked)}
              className="mt-1 accent-rose-500"
            />
            <span>
              Also delete its data —{" "}
              <span className="font-mono text-slate-400">{data.join(", ")}</span>
            </span>
          </label>
          <span className={`mt-2 block text-xs ${deleteData ? "text-rose-300" : "text-slate-500"}`}>
            {deleteData
              ? "The whole folder is removed. This cannot be undone."
              : `Kept in its folder — installing ${stack.name} again picks it back up.`}
          </span>
        </>
      )}
    </span>
  );
}
