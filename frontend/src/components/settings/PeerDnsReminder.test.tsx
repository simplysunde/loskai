import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { PeerDnsReminder } from "./PeerDnsReminder";

test("shows the AdGuard DNS hint when known", () => {
  render(<PeerDnsReminder dnsHint="192.168.10.101" />);
  expect(screen.getByText("192.168.10.101")).toBeInTheDocument();
});

test("falls back to generic guidance without a hint", () => {
  render(<PeerDnsReminder dnsHint={null} />);
  expect(screen.getByText(/your AdGuard server's IP/)).toBeInTheDocument();
});
