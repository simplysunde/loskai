import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { RecipeUpdates, type RecipeUpdate } from "./RecipeUpdates";
import { renderWithQuery, json } from "../../test/render";

const CURRENT: RecipeUpdate = {
  stack: "whoami",
  recipe: "whoami",
  name: "Whoami",
  icon: false,
  source: "loskai-recipes",
  status: "current",
  updatable: false,
  reason: null,
  images: [],
  diff: "",
  commits: [],
  new_env: [],
};

const JELLYFIN: RecipeUpdate = {
  ...CURRENT,
  stack: "jellyfin",
  recipe: "jellyfin",
  name: "Jellyfin",
  status: "available",
  updatable: true,
  images: [{ service: "jellyfin", from: "jellyfin/jellyfin:12.1", to: "jellyfin/jellyfin:12.2" }],
  diff: "--- installed\n+++ recipe\n-    image: jellyfin/jellyfin:12.1\n+    image: jellyfin/jellyfin:12.2\n",
  commits: [{ commit: "4d27a85", date: "2026-10-16", subject: "Jellyfin 12.2", body: "Fixes two migrations." }],
  new_env: ["TZ"],
};

// The dialog is the only place an update is offered, so what's pinned: it syncs before it
// reads, it says what changes before anything is replaced, and a refusal stays on screen.
function renderUpdates({
  list = [CURRENT, JELLYFIN] as RecipeUpdate[],
  apply = () => new Response(JSON.stringify({ ok: true, output: "Started" }), { status: 200 }),
} = {}) {
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) => {
    if (path.endsWith("/update-from-recipe")) return apply();
    const body = path.endsWith("/refresh") ? { ok: true, output: "" } : list;
    return json(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderWithQuery(<RecipeUpdates onClose={() => {}} />);
  return fetchMock;
}


test("it syncs the sources, then lists every installed recipe with what can be updated", async () => {
  const fetchMock = renderUpdates();

  expect(await screen.findByText("1 of 2 installed recipes can be updated.")).toBeInTheDocument();
  expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
    "/api/docker/recipes/refresh",
    "/api/docker/recipes/updates",
  ]);
  expect(screen.getByText("Up to date")).toBeInTheDocument();
  expect(screen.getByText("Update available")).toBeInTheDocument();
  expect(screen.getByText("jellyfin/jellyfin:12.1 → jellyfin/jellyfin:12.2")).toBeInTheDocument();
});

test("a recipe opens to what changes, and Update replaces it", async () => {
  const fetchMock = renderUpdates();

  fireEvent.click(await screen.findByText("Jellyfin"));
  expect(screen.getByText("Jellyfin 12.2")).toBeInTheDocument();
  expect(screen.getByText("Fixes two migrations.")).toBeInTheDocument();
  expect(screen.getByText("TZ")).toBeInTheDocument();
  expect(screen.getByText(/^\+\s+image: jellyfin\/jellyfin:12\.2$/)).toBeInTheDocument();

  fireEvent.click(screen.getByText("Update"));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([p, i]) => p === "/api/docker/stacks/jellyfin/update-from-recipe" && i?.method === "POST")).toBe(true),
  );
});

test("a hand-edited compose.yml is said before it is replaced", async () => {
  renderUpdates({ list: [{ ...JELLYFIN, status: "edited" }] });

  fireEvent.click(await screen.findByText("Jellyfin"));
  expect(screen.getByText(/changed by hand since the install — updating replaces it/)).toBeInTheDocument();
});

test("an untracked install warns before compose.yml is replaced, the why in a tooltip", async () => {
  renderUpdates({ list: [{ ...JELLYFIN, status: "untracked" }] });

  fireEvent.click(await screen.findByText("Jellyfin"));
  expect(screen.getByText(/check its volumes first/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Updating replaces compose.yml" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent(/your own changes too/);
});

test("one that can't be updated says why, with no Update button", async () => {
  renderUpdates({
    list: [{ ...JELLYFIN, updatable: false, reason: "the new version asks for TOKEN — reinstall to answer" }],
  });

  // It isn't counted as one that can be updated.
  expect(await screen.findByText("None can be updated here — each says why.")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Jellyfin"));
  expect(screen.getByText(/asks for TOKEN/)).toBeInTheDocument();
  expect(screen.queryByText("Update")).not.toBeInTheDocument();
});

test("a refused update stays on screen", async () => {
  renderUpdates({
    apply: () =>
      json({ detail: "the new version doesn't load with this stack's files: no image" }, 400),
  });

  fireEvent.click(await screen.findByText("Jellyfin"));
  fireEvent.click(screen.getByText("Update"));
  expect(await screen.findByText(/doesn't load with this stack's files/)).toBeInTheDocument();
});
