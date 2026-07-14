import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";

interface QuickCommand {
  label: string;
  command: string;
}

// Preset command buttons above the terminal — generic set + image-specific extras,
// detected server-side from the image name. Clicking runs the command in the terminal.
export function QuickCommands({
  containerId,
  onRun,
}: {
  containerId: string;
  onRun: (command: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["quick-commands", containerId],
    queryFn: () => api.get<QuickCommand[]>(`/api/docker/containers/${containerId}/quick-commands`),
    retry: false,
  });

  if (!data?.length) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {data.map((qc) => (
        <button
          key={qc.label}
          onClick={() => onRun(qc.command)}
          title={qc.command}
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          {qc.label}
        </button>
      ))}
    </div>
  );
}
