import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { RunningPill } from "./RunningPill";

const RUNNING = {
  ok: true,
  checked: 0,
  containers: [{ name: "jellyfin", image: "jellyfin/jellyfin:12.2", status: "Up 2 days" }],
  services: ["nginx"],
  hidden: 14,
  guests: [{ id: "101", name: "adguard", kind: "lxc" as const }],
  denied: ["qm"],
};

test("the pill counts what runs, and hovering lists all of it", () => {
  render(<RunningPill running={RUNNING} user="loskai" />);

  const pill = screen.getByText("3 running");
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.mouseEnter(pill);

  const card = screen.getByRole("tooltip");
  expect(card).toHaveTextContent("Containers (1)");
  expect(card).toHaveTextContent("jellyfin");
  expect(card).toHaveTextContent("Up 2 days");
  expect(card).toHaveTextContent("Guests (1)");
  expect(card).toHaveTextContent("LXC 101");
  expect(card).toHaveTextContent("Services (1)");
  expect(card).toHaveTextContent("nginx");
  // The base system is counted, not listed; a list the user can't read is named.
  expect(card).toHaveTextContent("+ 14 system services");
  expect(card).toHaveTextContent("loskai may not list VMs");
});

test("keyboard focus opens it too", () => {
  render(<RunningPill running={RUNNING} />);

  fireEvent.focus(screen.getByText("3 running"));

  expect(screen.getByRole("tooltip")).toBeInTheDocument();
});

test("a machine that can't be read says why in its tooltip", () => {
  render(<RunningPill running={{ ok: false, checked: 0, error: "Can't reach 192.168.10.50:22" }} />);

  expect(screen.getByText("unreachable")).toHaveAttribute("title", "Can't reach 192.168.10.50:22");
});
