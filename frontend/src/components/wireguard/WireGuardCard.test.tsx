import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { WireGuardCard } from "./WireGuardCard";

test("shows online + the AdGuard DNS hint when reachable", () => {
  render(
    <WireGuardCard
      health={{
        status: "healthy",
        reachable: true,
        url: "http://192.168.10.102:51821",
        dns_hint: "192.168.10.101",
      }}
    />,
  );
  expect(screen.getByText("online")).toBeInTheDocument();
  expect(screen.getByText("192.168.10.101")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: /Open wg-dashboard/ });
  expect(link).toHaveAttribute("href", "http://192.168.10.102:51821");
});

test("falls back to generic DNS guidance without an AdGuard hint", () => {
  render(<WireGuardCard health={{ status: "unconfigured", dns_hint: null }} />);
  expect(screen.getByText("not configured")).toBeInTheDocument();
  expect(screen.getByText(/your AdGuard server's IP/)).toBeInTheDocument();
});
