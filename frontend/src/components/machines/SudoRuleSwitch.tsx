import { updatesItself, type Facts } from "../../lib/ssh";
import type { ToolStart } from "../../lib/toolRows";
import { Switch } from "../shared/SettingRow";
import { Hint } from "../shared/Hint";

// Updates without a password — Loskai's sudo rule on the machine (logic.SUDO_RULE), for
// exactly System's update commands — as a switch: in the machine's dialog, and beside each
// machine in Update all. Root needs none; a machine that won't show /etc/sudoers.d can't
// say. Either way an automatic run in the machine's terminal (`onRun`); the switch moves
// when the overview reads the rule back.
export function SudoRuleSwitch({
  user,
  facts,
  onRun,
  disabled = false,
  short = false,
}: {
  user: string;
  facts: Facts | undefined;
  onRun: ToolStart;
  disabled?: boolean;
  // Beside a machine in a list: its notes in fewer words.
  short?: boolean;
}) {
  if (user === "root") {
    return <span className="text-xs text-slate-500">{short ? "root — no sudo needed" : "not needed — it logs in as root"}</span>;
  }
  if (!facts?.ok) {
    return short ? null : <span className="text-xs text-slate-500">needs its overview — see General</span>;
  }
  const on = facts.sudo_rule === "on";
  // Nothing to update without a password where the system updates itself — a rule already
  // there can still be taken off.
  if (updatesItself(facts) && !on) {
    return <span className="text-xs text-slate-500">not used — it updates itself</span>;
  }
  return (
    <>
      {facts.sudo_rule !== "on" && facts.sudo_rule !== "off" && (
        <span className="text-xs text-slate-500">
          <Hint text="The machine doesn't let its user look in /etc/sudoers.d">can't tell</Hint>
        </span>
      )}
      <Switch
        label="Updates without a password"
        title={on ? "Take the rule off: Update asks for sudo's password again" : "Add the rule: asks for sudo's password this once"}
        checked={on}
        disabled={disabled}
        onChange={() =>
          on
            ? onRun({ sudo: "remove", title: "Take off updates without a password" })
            : onRun({ sudo: "allow", title: "Allow updates without a password" })
        }
      />
    </>
  );
}
