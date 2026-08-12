import { fireEvent, render, screen } from "@testing-library/react";
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
    upstream_healthy: true,
    ...overrides,
  };
}

test("renders the DNS column states", () => {
  const { rerender } = render(<ServiceTable rows={[row({ dnsPresent: true })]} />);
  expect(screen.getByText("rewrite set")).toBeInTheDocument();

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

test("a dns_only row shows a dns-only tag and dashes for Route/Live", () => {
  render(
    <ServiceTable
      rows={[
        row({
          id: "vm1", name: "vm1", type: "external", subdomain: "vm1", fqdn: "vm1.example.no",
          upstream: "192.168.10.55", route_mode: "dns_only", synced: null, upstream_healthy: null,
        }),
      ]}
    />,
  );
  expect(screen.getByText("dns-only")).toBeInTheDocument();
  // Route + Live cells both render the dash placeholder — two "—" in the row.
  expect(screen.getAllByText("—")).toHaveLength(2);
});

test("a proxy row with known sync/health state shows real badges, not dashes", () => {
  render(<ServiceTable rows={[row({ route_mode: "proxy" })]} />);
  expect(screen.getByText("synced")).toBeInTheDocument();
  expect(screen.getByText("up")).toBeInTheDocument();
  expect(screen.queryByText("dns-only")).not.toBeInTheDocument();
});
