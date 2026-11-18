import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ServiceTable, type Instance } from "./ServiceTable";

function row(overrides: Partial<Instance> = {}): Instance {
  return {
    id: "grafana",
    name: "Grafana",
    type: "docker",
    kind: "service",
    subdomain: "grafana",
    fqdn: "grafana.example.no",
    upstream: "192.168.10.100:3000",
    private: false,
    routed: true,
    synced: true,
    ...overrides,
  };
}

test("renders the DNS column states", () => {
  const { rerender } = render(<ServiceTable rows={[row({ dnsPresent: true })]} />);
  expect(screen.getByText("set")).toBeInTheDocument();

  rerender(<ServiceTable rows={[row({ dnsPresent: false })]} />);
  expect(screen.getByText("missing")).toBeInTheDocument();

  rerender(<ServiceTable rows={[row({ dnsPresent: null })]} />);
  expect(screen.getByText("unknown")).toBeInTheDocument();

  rerender(<ServiceTable rows={[row({ dnsPresent: true, dnsConflict: true })]} />);
  expect(screen.getByText("conflict")).toBeInTheDocument();
});

test("routed docker row: remove-route, private, and delete are all available", () => {
  const onRemoveRoute = vi.fn();
  const onTogglePrivate = vi.fn();
  const onDelete = vi.fn();
  render(
    <ServiceTable
      rows={[row({ type: "docker" })]}
      onRemoveRoute={onRemoveRoute}
      onTogglePrivate={onTogglePrivate}
      onDelete={onDelete}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove route (keep the instance)" }));
  expect(onRemoveRoute).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Public on dashboard" }));
  expect(onTogglePrivate).toHaveBeenCalledOnce();
  // docker instances can now be deleted like any other
  fireEvent.click(screen.getByRole("button", { name: "Delete instance" }));
  expect(onDelete).toHaveBeenCalledOnce();
});

test("routed row offers Change URL in place", () => {
  const onAssign = vi.fn();
  render(<ServiceTable rows={[row({ routed: true })]} onAssign={onAssign} />);
  fireEvent.click(screen.getByRole("button", { name: "Change URL" }));
  expect(onAssign).toHaveBeenCalledOnce();
});

test("external routed row can be deleted; unrouted row shows Assign", () => {
  const onDelete = vi.fn();
  const onAssign = vi.fn();
  const { rerender } = render(
    <ServiceTable rows={[row({ type: "external" })]} onDelete={onDelete} onAssign={onAssign} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete instance" }));
  expect(onDelete).toHaveBeenCalledOnce();

  rerender(
    <ServiceTable
      rows={[row({ type: "external", routed: false, subdomain: null, fqdn: null })]}
      onAssign={onAssign}
      onDelete={onDelete}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Assign a URL" }));
  expect(onAssign).toHaveBeenCalledOnce();
});

test("a proxy row with known sync state shows a real badge, not a dash", () => {
  render(<ServiceTable rows={[row({ route_mode: "proxy" })]} />);
  expect(screen.getByText("synced")).toBeInTheDocument();
  expect(screen.queryByText("dns-only")).not.toBeInTheDocument();
});

test("a route on a machine's address shows the address, the machine beneath", () => {
  // The address stays on top — a machine's name is not an address (`adguard.lxc:3000`
  // would not resolve) — and the machine beneath says this route moves with it.
  render(
    <ServiceTable
      rows={[row({ id: "plex", name: "plex", upstream: "192.168.10.50:32400" })]}
      machines={[row({ id: "nas", name: "nas", fqdn: "nas.example.no", upstream: "192.168.10.50", kind: "machine" })]}
    />,
  );
  expect(screen.getByText("192.168.10.50:32400")).toBeInTheDocument();
  // The full name — `nas` alone would not resolve.
  fireEvent.click(screen.getByRole("button", { name: "nas.example.no" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent(/moves with it/);
  expect(screen.queryByText("nas:32400")).not.toBeInTheDocument();
});

test("a route on no machine's address shows its address alone", () => {
  render(
    <ServiceTable
      rows={[row({ upstream: "192.168.10.5:8080" })]}
      machines={[row({ id: "nas", name: "nas", fqdn: "nas.example.no", upstream: "192.168.10.50", kind: "machine" })]}
    />,
  );
  expect(screen.getByText("192.168.10.5:8080")).toBeInTheDocument();
  expect(screen.queryByText("nas.example.no")).not.toBeInTheDocument();  // a prefix, not it
});

test("a machine with no DNS name is named by its plain name", () => {
  render(
    <ServiceTable
      rows={[row({ id: "plex", name: "plex", upstream: "192.168.10.50:32400" })]}
      machines={[row({ id: "nas", name: "Storage box", fqdn: null, upstream: "192.168.10.50", kind: "machine" })]}
    />,
  );
  expect(screen.getByText("Storage box")).toBeInTheDocument();
});

test("a route following its container says so over its machine", () => {
  // It doesn't move with the machine: its address is the container's.
  render(
    <ServiceTable
      rows={[row({ id: "whoami", name: "whoami", upstream: "192.168.10.50:8081", follow_container: true })]}
      machines={[row({ id: "nas", name: "nas", fqdn: "nas.example.no", upstream: "192.168.10.50", kind: "machine" })]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "nas.example.no" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent(/follows its container/);
});

test("a non-default scheme is tagged, https is not", () => {
  // A tag on every row would be noise: https is what almost everything should be.
  render(
    <ServiceTable
      rows={[
        row({ id: "tv", name: "tv", scheme: "http" }),
        row({ id: "printer", name: "printer", scheme: "both" }),
        row({ id: "grafana", name: "grafana", scheme: "https" }),
      ]}
    />,
  );

  expect(screen.getByText("http")).toBeInTheDocument();
  expect(screen.getByText("both")).toBeInTheDocument();
  expect(screen.queryByText("https")).not.toBeInTheDocument();
});

test("a service offers an icon picker; a machine does not", () => {
  // A machine has no launcher card, so there is nothing for an icon to appear on.
  render(
    <ServiceTable
      rows={[
        row({ id: "grafana", name: "grafana" }),
        row({ id: "nas", name: "nas", upstream: "192.168.10.50", kind: "machine" }),
      ]}
      onIcon={() => {}}
    />,
  );

  expect(screen.getByTitle(/Set a launcher icon/)).toBeInTheDocument();
  expect(screen.getAllByTitle(/launcher icon/)).toHaveLength(1);
});

test("an uploaded icon is shown, with a control to remove it", () => {
  render(
    <ServiceTable
      rows={[row({ id: "grafana", name: "grafana", icon: "/api/instances/grafana/icon" })]}
      onIcon={() => {}}
      onClearIcon={() => {}}
    />,
  );

  expect(screen.getByTitle("Change the launcher icon")).toBeInTheDocument();
  expect(screen.getByTitle("Remove the launcher icon")).toBeInTheDocument();
});

test("a routed name opens the site at the server's url — over http when that is all it serves", () => {
  render(
    <ServiceTable
      rows={[
        row({ id: "grafana", name: "grafana", fqdn: "grafana.example.no", url: "https://grafana.example.no" }),
        row({ id: "tv", name: "tv", fqdn: "tv.example.no", scheme: "http", url: "http://tv.example.no" }),
        row({ id: "off", name: "off", routed: false, subdomain: null, fqdn: null }),
      ]}
    />,
  );

  expect(screen.getByRole("link", { name: "grafana.example.no" })).toHaveAttribute(
    "href",
    "https://grafana.example.no",
  );
  expect(screen.getByRole("link", { name: "tv.example.no" })).toHaveAttribute(
    "href",
    "http://tv.example.no",
  );
  expect(screen.getByText("not routed")).toBeInTheDocument();
});

test("each status header explains itself in a hint", () => {
  render(<ServiceTable rows={[row({ id: "echo", name: "echo" })]} />);

  for (const name of ["Route", "DNS"]) {
    fireEvent.click(within(screen.getByRole("columnheader", { name })).getByRole("button", { name }));
    expect(screen.getByRole("tooltip")).not.toBeEmptyDOMElement();
    fireEvent.keyDown(window, { key: "Escape" });
  }
});


// --- Links (Phase 45) ---

const LINK = row({
  id: "jellyfin", name: "Jellyfin", subdomain: null, fqdn: null, routed: false, synced: null,
  route_mode: "direct", upstream: "192.168.10.220:8096", url: "http://192.168.10.220:8096",
});

test("a link opens at its address, is tagged, and is edited as a link or given a name", () => {
  const onLink = vi.fn();
  const onAssign = vi.fn();
  const onTogglePrivate = vi.fn();
  render(<ServiceTable rows={[LINK]} onLink={onLink} onAssign={onAssign} onTogglePrivate={onTogglePrivate} />);

  expect(screen.getByRole("link", { name: "192.168.10.220:8096" })).toHaveAttribute("href", "http://192.168.10.220:8096");
  expect(screen.getByText("link")).toBeInTheDocument();
  expect(screen.getByTitle("Public on dashboard")).toBeInTheDocument(); // on the Dashboard, so hideable
  fireEvent.click(screen.getByTitle("Edit link"));
  fireEvent.click(screen.getByTitle("Give it an HTTPS name"));
  expect(onLink).toHaveBeenCalledWith(LINK);
  expect(onAssign).toHaveBeenCalledWith(LINK);
});

test("without Caddy nothing offers a route; an unrouted row offers a link", () => {
  const onLink = vi.fn();
  const unrouted = row({ id: "immich", name: "immich", subdomain: null, fqdn: null, routed: false, synced: null });
  render(<ServiceTable rows={[LINK, unrouted]} caddySetUp={false} onLink={onLink} onAssign={() => {}} />);

  expect(screen.queryByTitle("Give it an HTTPS name")).not.toBeInTheDocument();
  expect(screen.queryByTitle("Assign a URL")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle("Make a link"));
  expect(onLink).toHaveBeenCalledWith(unrouted);
});

// A route removed is an unrouted row: it can get a name again, or become a link — the same
// record, never a second row for the same service.
test("with Caddy, an unrouted row offers a URL and a link", () => {
  const onLink = vi.fn();
  const onAssign = vi.fn();
  const unrouted = row({ id: "nas", name: "nas", subdomain: null, fqdn: null, routed: false, synced: null });
  render(<ServiceTable rows={[unrouted]} onLink={onLink} onAssign={onAssign} />);

  fireEvent.click(screen.getByTitle("Assign a URL"));
  fireEvent.click(screen.getByTitle("Make a link"));
  expect(onAssign).toHaveBeenCalledWith(unrouted);
  expect(onLink).toHaveBeenCalledWith(unrouted);
});

// Without Caddy the page's one button is Add link: the empty table names that, not a URL.
test("an empty table says how to add the first one, by what the page offers", () => {
  const { rerender } = render(<ServiceTable rows={[]} />);
  expect(screen.getByText("No services yet. Add route gives one a name.")).toBeInTheDocument();

  rerender(<ServiceTable rows={[]} caddySetUp={false} />);
  expect(screen.getByText("No services yet. Add a link to put one on the Dashboard.")).toBeInTheDocument();
});
