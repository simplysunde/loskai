// Where a route or a link opens, as a small teal pill — the Docker tab's container rows, the
// Routing table and the Machines tab share it, so they read the same. `url` is the server's
// (instances.open_url): a route's name over the protocol it is served on, a link's address.
// The pill shows it without the scheme.
export function RouteLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] text-teal-300 hover:bg-teal-500/25"
    >
      {url.replace(/^https?:\/\//, "")}
    </a>
  );
}
