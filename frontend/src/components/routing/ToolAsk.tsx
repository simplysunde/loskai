import { useState } from "react";
import { Plus } from "lucide-react";

import type { ToolStart } from "../../lib/toolRows";
import { askedOf, type Tool, type ToolAction } from "../../lib/tools";
import { TOOL_BUTTON } from "../../lib/ui";
import { ActionIcon } from "./ToolIcon";


// An action that runs on a name typed for it — a new session, a new project. The server
// checks the name; it reaches the command as `$1`.
export function Ask({ tool, action, onRun }: { tool: Tool; action: ToolAction; onRun: ToolStart }) {
  const [name, setName] = useState("");
  const asked = askedOf(action.ask);
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onRun({ tool: tool.id, action: action.id, target: name.trim(), title: `${action.label}: ${name.trim()}` }, action);
        // One that asks first keeps the name, so a Cancel there loses nothing.
        if (!action.confirm) setName("");
      }}
    >
      <input
        aria-label={`${action.label} — ${asked.what}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={asked.placeholder}
        className={`${asked.width} min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200`}
      />
      <button type="submit" disabled={!name.trim()} title={`${action.description}\n$ ${typeof action.run === "string" ? action.run : ""}`} className={TOOL_BUTTON}>
        <ActionIcon tool={tool.id} action={action.id} className="h-3.5 w-3.5" fallback={Plus} /> {action.label}
      </button>
    </form>
  );
}
