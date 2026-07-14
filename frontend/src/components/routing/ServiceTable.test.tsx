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

test("rewrite action fires and is disabled when DNS status is unknown", () => {
  const onToggle = vi.fn();
  const { rerender } = render(
    <ServiceTable rows={[row({ dnsPresent: false })]} onToggleRewrite={onToggle} />,
  );
  const btn = screen.getByRole("button", { name: /Rewrite/ });
  fireEvent.click(btn);
  expect(onToggle).toHaveBeenCalledOnce();

  rerender(
    <ServiceTable rows={[row({ dnsPresent: null })]} onToggleRewrite={onToggle} />,
  );
  expect(screen.getByRole("button", { name: /Rewrite/ })).toBeDisabled();
});
