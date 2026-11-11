import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { RunningPill } from "./RunningPill";

const RUNNING = {
  ok: true,
  checked: 0,
  containers: [{ name: "jellyfin", image: "jellyfin/jellyfin:12.2", status: "Up 2 days", ports: [8096] }],
  services: ["nginx"],
  hidden: 14,
  guests: [{ id: "101", name: "adguard", kind: "lxc" as const }],
  denied: ["qm", "listen"],
};

test("the pill counts what runs, and a click lists all of it", () => {
  render(<RunningPill running={RUNNING} user="loskai" />);

  const pill = screen.getByRole("button", { name: "3 running" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(pill);

  const card = screen.getByRole("dialog", { name: "Running" });
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
  // Which service holds a port is the Add route picker's to say, not this list's.
  expect(card).not.toHaveTextContent("listen");
});

test("Esc, a click outside, or the pill again closes it", () => {
  render(<RunningPill running={RUNNING} />);
  const pill = screen.getByRole("button", { name: "3 running" });

  fireEvent.click(pill);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  fireEvent.click(pill);
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  fireEvent.click(pill);
  fireEvent.click(pill);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("each row gets its actions, and one clicked closes the card", () => {
  const route = vi.fn();
  render(
    <RunningPill
      running={RUNNING}
      actions={(target, id) => target === "container" && <button onClick={() => route(id)}>Route it</button>}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "3 running" }));
  fireEvent.click(screen.getByRole("button", { name: "Route it" }));

  expect(route).toHaveBeenCalledWith("jellyfin");
  // What it opens is a dialog of its own; the card mustn't sit over it.
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a machine that can't be read says why in its tooltip", () => {
  render(<RunningPill running={{ ok: false, checked: 0, error: "Can't reach 192.168.10.50:22" }} />);

  expect(screen.getByText("unreachable")).toHaveAttribute("title", "Can't reach 192.168.10.50:22");
});
