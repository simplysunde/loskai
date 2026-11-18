import type { Stack } from "./groupByStack";

// What Delete on a stack does, in the reader's terms, and the one choice it offers. Which
// files go is the code's and CLAUDE.md's (stacks.delete_stack): the dialog says the stack
// goes and its data stays, which a reinstall picks back up. Taking the data too is a
// deliberate tick, never the default.
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
      Stops <span className="font-medium text-slate-200">{stack.name}</span> and removes it.
      {data.length > 0 && (
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
              ? "Its data is deleted too. This cannot be undone."
              : `Its data is kept — installing ${stack.name} again picks it back up.`}
          </span>
        </>
      )}
    </span>
  );
}
