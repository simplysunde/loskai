import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { RecipeSources } from "./RecipeSources";

const SETTINGS = "/api/settings";
const RECIPES = "/api/docker/recipes";
const REFRESH = "/api/docker/recipes/refresh";

const BUILTIN = "http://192.168.10.216:3000/sunde/loskai-recipes.git";
const EXTRA = "https://github.com/someone/extras.git";

// The panel is the only place the sources list can be changed from the UI, and every
// change is a full-list PUT — so what's worth pinning is the *body* it sends: a toggle
// must not drop the other rows, and a remove must not silently disable instead.
function renderPanel({
  sources = [{ url: BUILTIN, enabled: true, name: null, builtin: true }] as unknown[],
  source = "stored",
  status = [
    { url: BUILTIN, label: "loskai-recipes", enabled: true, builtin: true, synced: true, count: 3 },
  ] as unknown[],
  saveStatus = 200,
  saveDetail = "",
} = {}) {
  const fetchMock = vi.fn(async (path: string, options?: RequestInit) => {
    if (path === SETTINGS && options?.method === "PUT") {
      return new Response(JSON.stringify(saveStatus === 200 ? {} : { detail: saveDetail }), {
        status: saveStatus,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body =
      path === SETTINGS
        ? { recipes_repos: { value: sources, source, secret: false } }
        : path === RECIPES
          ? { sources: status, local_count: 1 }
          : { ok: true, results: [{ url: BUILTIN, label: "loskai-recipes", ok: true, output: "up to date" }] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <RecipeSources />
    </QueryClientProvider>,
  );
  return {
    fetchMock,
    saved: () =>
      fetchMock.mock.calls
        .filter(([p, o]) => p === SETTINGS && (o as RequestInit | undefined)?.method === "PUT")
        .map(([, o]) => JSON.parse(String((o as RequestInit).body)).recipes_repos),
    synced: () =>
      fetchMock.mock.calls
        .filter(([p]) => p === REFRESH)
        .map(([, o]) => ((o as RequestInit).body ? JSON.parse(String((o as RequestInit).body)) : null)),
  };
}

afterEach(() => vi.unstubAllGlobals());

test("the built-in default is listed as an ordinary, labelled row", async () => {
  renderPanel();

  expect(await screen.findByText(BUILTIN)).toBeInTheDocument();
  expect(screen.getByText("built-in default")).toBeInTheDocument();
  expect(screen.getByText("3 recipes")).toBeInTheDocument();
});

test("disabling a source keeps every other row in the saved list", async () => {
  const { saved } = renderPanel({
    sources: [
      { url: BUILTIN, enabled: true, builtin: true },
      { url: EXTRA, enabled: true, builtin: false },
    ],
  });

  fireEvent.click(await screen.findByLabelText(`Enable ${BUILTIN}`));

  await waitFor(() => expect(saved()).toHaveLength(1));
  expect(saved()[0]).toEqual([
    { url: BUILTIN, enabled: false, builtin: true },
    { url: EXTRA, enabled: true, builtin: false },
  ]);
});

test("removing the last source saves an empty list rather than nothing", async () => {
  // An empty list is a real stored value — it is how "no git sources" survives a
  // restart instead of the built-in default re-seeding itself.
  const { saved } = renderPanel();

  fireEvent.click(await screen.findByLabelText(`Remove ${BUILTIN}`));

  await waitFor(() => expect(saved()).toHaveLength(1));
  expect(saved()[0]).toEqual([]);
});

test("a new source is appended, so it cannot outrank the existing ones by accident", async () => {
  const { saved } = renderPanel();

  fireEvent.change(await screen.findByLabelText("Recipe source URL"), {
    target: { value: `  ${EXTRA}  ` },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() => expect(saved()).toHaveLength(1));
  expect(saved()[0]).toEqual([
    { url: BUILTIN, enabled: true, name: null, builtin: true },
    { url: EXTRA, enabled: true },
  ]);
});

test("a rejected list surfaces the backend's reason", async () => {
  renderPanel({
    saveStatus: 422,
    saveDetail: "Recipe source must be an http:// or https:// git URL — got 'nope'",
  });

  fireEvent.change(await screen.findByLabelText("Recipe source URL"), {
    target: { value: "nope" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(await screen.findByText(/must be an http:\/\/ or https:\/\/ git URL/)).toBeInTheDocument();
});

test("a single row's sync targets that source, not every source", async () => {
  const { synced } = renderPanel();

  fireEvent.click(await screen.findByTitle("Sync this source"));

  await waitFor(() => expect(synced()).toEqual([{ url: BUILTIN }]));
});

test("an env-set list is read-only — no toggles, no add box", async () => {
  renderPanel({ source: "env" });

  expect(await screen.findByText(/Set by/)).toBeInTheDocument();
  expect((screen.getByLabelText(`Enable ${BUILTIN}`) as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByLabelText("Recipe source URL")).not.toBeInTheDocument();
  expect(screen.queryByTitle("Remove this source")).not.toBeInTheDocument();
});
