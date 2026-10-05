// A routed name as a small teal pill that opens it — the Docker tab's container rows and the
// Routing table's service rows share it, so the two read the same. An `http` route links
// over http: it has no certificate, so https would not connect.
export function RouteLink({
  host,
  scheme,
}: {
  host: string;
  scheme?: "https" | "both" | "http" | null;
}) {
  return (
    <a
      href={`${scheme === "http" ? "http" : "https"}://${host}`}
      target="_blank"
      rel="noreferrer"
      className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] text-teal-300 hover:bg-teal-500/25"
    >
      {host}
    </a>
  );
}
