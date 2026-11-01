import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test } from "vitest";

import { SettingsLayout } from "./SettingsLayout";

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<div>general pane</div>} />
          <Route path="network" element={<div>network pane</div>} />
          <Route path="security" element={<div>security pane</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

test("renders every category in the sub-nav", () => {
  at("/settings");
  for (const label of ["General", "Network", "SSH", "Security"]) {
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  }
});

test("renders the child route's pane", () => {
  at("/settings/network");
  expect(screen.getByText("network pane")).toBeInTheDocument();
  expect(screen.queryByText("general pane")).not.toBeInTheDocument();
});

// `end` on the index link is what stops General staying highlighted on every child route.
test("marks only the active category", () => {
  at("/settings/security");
  expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "General" })).not.toHaveAttribute("aria-current");
});
