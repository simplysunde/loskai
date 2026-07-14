import { useQuery } from "@tanstack/react-query";
import { Boxes, Cpu, HardDrive, MemoryStick } from "lucide-react";

import { api } from "../../lib/api";
import { formatBytes } from "../../lib/format";

interface HostStats {
  containers: number;
  containers_running: number;
  images: number;
  ncpu: number;
  mem_total: number;
  disk_images_bytes: number;
  disk_volumes_bytes: number;
  docker_version: string;
}

// Host-level resource summary. Silent when the daemon is down (the module banner already
// says so).
export function StatsBar() {
  const { data, isError } = useQuery({
    queryKey: ["docker-stats"],
    queryFn: () => api.get<HostStats>("/api/docker/stats"),
    refetchInterval: 10_000,
    retry: false,
  });
  if (isError || !data) return null;

  const tiles = [
    { icon: Boxes, label: "Containers", value: `${data.containers_running}/${data.containers}` },
    { icon: Cpu, label: "CPUs", value: String(data.ncpu ?? "—") },
    { icon: MemoryStick, label: "Memory", value: formatBytes(data.mem_total) },
    { icon: HardDrive, label: "Images + volumes", value: formatBytes(data.disk_images_bytes + data.disk_volumes_bytes) },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map(({ icon: Icon, label, value }) => (
        <div key={label} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <Icon className="h-5 w-5 text-teal-300" />
          <div>
            <div className="text-sm font-medium text-slate-100">{value}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
