import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ServiceTable, type RouteRow } from "./ServiceTable";

function row(overrides: Partial<RouteRow> = {}): RouteRow {
  return {
    id: "grafana",
    name: "Grafana",
    type: "docker",
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

test("a dns_only row shows a dns-only tag and a dash for Route", () => {
  render(
    <ServiceTable
      rows={[
        row({
          id: "vm1", name: "vm1", type: "external", subdomain: "vm1", fqdn: "vm1.example.no",
          upstream: "192.168.10.55", route_mode: "dns_only", synced: null,
        }),
      ]}
    />,
  );
  expect(screen.getByText("dns-only")).toBeInTheDocument();
  expect(screen.getAllByText("—")).toHaveLength(1);
});

test("a proxy row with known sync state shows a real badge, not a dash", () => {
  render(<ServiceTable rows={[row({ route_mode: "proxy" })]} />);
  expect(screen.getByText("synced")).toBeInTheDocument();
  expect(screen.queryByText("dns-only")).not.toBeInTheDocument();
});

test("a linked upstream shows its address, the machine it follows beneath", () => {
  // Otherwise the link is invisible: the address looks hand-typed right up until the
  // machine moves and this row quietly follows it. The address stays on top — a machine's
  // name is not an address (`adguard.lxc:3000` would not resolve).
  render(
    <ServiceTable
      rows={[row({ id: "plex", name: "plex", upstream: "192.168.10.50:32400", machine: "nas" })]}
      machines={[row({ id: "nas", name: "nas", upstream: "192.168.10.50", kind: "machine" })]}
    />,
  );
  expect(screen.getByText("192.168.10.50:32400")).toBeInTheDocument();
  expect(screen.getByText("nas").closest("div")).toContainElement(
    screen.getByRole("img", { name: /^Linked/ }),
  );
  expect(screen.queryByText("nas:32400")).not.toBeInTheDocument();
});

test("an unlinked route shows its address as it is", () => {
  render(<ServiceTable rows={[row({ upstream: "192.168.10.77:8080" })]} />);
  expect(screen.getByText("192.168.10.77:8080")).toBeInTheDocument();
});

test("a linked upstream follows a rename", () => {
  // The link is stored by id, which never changes — so it must resolve to what the
  // machine is called now, not the name it happened to be created under.
  render(
    <ServiceTable
      rows={[row({ id: "plex", name: "plex", upstream: "192.168.10.50:32400", machine: "nas" })]}
      machines={[row({ id: "nas", name: "Storage box", upstream: "192.168.10.50", kind: "machine" })]}
    />,
  );
  expect(screen.getByText("Storage box")).toBeInTheDocument();
});

test("a machine that is no longer listed falls back to its id", () => {
  render(<ServiceTable rows={[row({ id: "plex", upstream: "192.168.10.50:32400", machine: "ghost" })]} />);
  expect(screen.getByText("ghost")).toBeInTheDocument();
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

test("a routed name opens the site — over http when that is all it serves", () => {
  render(
    <ServiceTable
      rows={[
        row({ id: "grafana", name: "grafana", fqdn: "grafana.example.no" }),
        row({ id: "tv", name: "tv", fqdn: "tv.example.no", scheme: "http" }),
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

test("each status header explains itself on hover", () => {
  render(<ServiceTable rows={[row({ id: "echo", name: "echo" })]} />);

  for (const name of ["Route", "DNS"]) {
    expect(screen.getByRole("columnheader", { name })).toHaveAttribute("title");
  }
});

test("an unlinked upstream on a machine's address names that machine, without linking", () => {
  render(
    <ServiceTable
      rows={[
        row({ id: "plex", name: "plex", upstream: "192.168.10.50:32400" }),
        row({ id: "linked", name: "linked", upstream: "192.168.10.50:8080", machine: "nas" }),
        row({ id: "elsewhere", name: "elsewhere", upstream: "192.168.10.99:80" }),
      ]}
      machines={[
        row({ id: "nas", name: "Storage box", upstream: "192.168.10.50", fqdn: "nas.example.no", kind: "machine" }),
      ]}
    />,
  );

  // Its name, not its FQDN — the upstream cell is busy enough.
  const plex = screen.getByText("plex").closest("tr") as HTMLElement;
  expect(plex).toHaveTextContent("192.168.10.50:32400");
  expect(within(plex).getByText("Storage box")).toBeInTheDocument();
  expect(within(plex).getByRole("img", { name: /^Matched by IP/ })).toBeInTheDocument();
  // The linked row names the machine too, with the other icon; the unrelated one, nothing.
  const linked = screen.getByText("linked").closest("tr") as HTMLElement;
  expect(within(linked).getByRole("img", { name: /^Linked/ })).toBeInTheDocument();
  expect(within(linked).queryByRole("img", { name: /^Matched by IP/ })).not.toBeInTheDocument();
  expect(screen.getAllByText("Storage box")).toHaveLength(2);
  expect(screen.queryByText("nas.example.no")).not.toBeInTheDocument();
});
