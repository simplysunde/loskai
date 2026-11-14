import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { copyText } from "../../lib/clipboard";

// Copies `text`, and shows a check for two seconds once it is on the clipboard. `label`
// names it for a screen reader — or, given `shown`, beside the icon too ("Copied" a moment).
export function CopyButton({
  text,
  title,
  label,
  shown,
  className,
}: {
  text: string;
  title: string;
  label?: string;
  shown?: string;
  className: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={title}
      onClick={async () => {
        if (!(await copyText(text))) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={className}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {shown ? <span aria-hidden={label ? true : undefined}>{copied ? "Copied" : shown}</span> : null}
      {label && <span className="sr-only">{label}</span>}
    </button>
  );
}
