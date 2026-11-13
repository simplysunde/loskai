import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { Dashboard } from "./Dashboard";
import { json, renderWithQuery } from "../test/render";

test("two entries with the same name are two cards, each opening its own address", async () => {
  // Names may repeat — two links both called NAS; ids never do.
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        services: [
          { id: "nas", name: "NAS", url: "http://192.168.10.50:5000", icon: null },
          { id: "nas-2", name: "NAS", url: "http://192.168.10.51:5000", icon: null },
        ],
        certificate_tab: "public",
      }),
    ),
  );
  renderWithQuery(<Dashboard />);

  const cards = await screen.findAllByRole("link", { name: /NAS/ });
  expect(cards.map((a) => a.getAttribute("href"))).toEqual(["http://192.168.10.50:5000", "http://192.168.10.51:5000"]);
  expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  errors.mockRestore();
});
