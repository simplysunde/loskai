import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { StackEditor } from "./StackEditor";
import type { StackFormData } from "./StackForm";

const FORM: StackFormData = {
  settings: [
    { key: "PORT", label: "Host port", value: "8096", default: "8096" },
    { key: "TZ", label: null, value: "", default: "Europe/Oslo" },
  ],
  folders: [{ service: "jellyfin", source: "/srv/media/anime", target: "/media/anime", writable: true }],
  override_other: false,
  override_comments: false,
  services: ["jellyfin"],
  app: [
    {
      service: "jellyfin",
      image: "jellyfin/jellyfin:12.2",
      network: null,
      ports: ["8096 → 8096"],
      volumes: ["./config → /config", "cache → /cache"],
    },
  ],
  recipe: { id: "jellyfin", name: "Jellyfin", icon: false },
};

// The form is what Edit opens to, so what's pinned: the files read as labelled values, only
// what changed is sent, a bad folder is said before saving, and the app is shown, not edited.
function renderForm(form: StackFormData = FORM) {
  const onClose = vi.fn();
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const detail = { compose: "", compose_file: "compose.yml", env: "", override: null, override_file: null, services: [] };
    const body = path.endsWith("/action")
      ? { ok: true, output: "Started" }
      : init?.method === "PUT" && JSON.parse(String(init.body)).preview
        ? { env: 'PORT="9000"\n', override: "" }
        : path.endsWith("/form")
          ? form
          : detail;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <StackEditor name="jellyfin" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { fetchMock, onClose };
}

const sent = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => JSON.parse(init.body));

afterEach(() => vi.unstubAllGlobals());

test("the stack opens as labelled values, the app read-only", async () => {
  renderForm();

  expect(await screen.findByLabelText("Host port")).toHaveValue("8096");
  expect(screen.getByLabelText("TZ")).toHaveAttribute("placeholder", "Europe/Oslo");
  expect(screen.getByLabelText("Folder 1 on the host")).toHaveValue("/srv/media/anime");
  expect(screen.getByLabelText("Folder 1 in the container")).toHaveValue("/media/anime");
  expect(screen.getByText("jellyfin/jellyfin:12.2")).toBeInTheDocument();
  expect(screen.getByText("./config")).toBeInTheDocument();
  expect(screen.getByText("/cache")).toBeInTheDocument();
  expect(screen.getByTitle(/From the Jellyfin recipe/)).toBeInTheDocument();
  // Nothing changed yet: nothing to save.
  expect(screen.getByText("Save + re-up").closest("button")).toBeDisabled();
});

test("saving sends only the changed values, and the folders when they changed", async () => {
  const { fetchMock, onClose } = renderForm();

  fireEvent.change(await screen.findByLabelText("Host port"), { target: { value: "9000" } });
  fireEvent.click(screen.getByText("Save + re-up"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(sent(fetchMock)).toEqual([{ settings: { PORT: "9000" } }]);
  expect(fetchMock.mock.calls.some(([p]) => p === "/api/docker/stacks/jellyfin/action")).toBe(true);
});

test("a folder is added as a row: host, container, writable", async () => {
  const { fetchMock, onClose } = renderForm();

  fireEvent.click(await screen.findByText("Add folder"));
  fireEvent.change(screen.getByLabelText("Folder 2 on the host"), { target: { value: "/srv/media/films" } });
  fireEvent.change(screen.getByLabelText("Folder 2 in the container"), { target: { value: "/media/films" } });
  fireEvent.click(screen.getByLabelText("Folder 2 writable"));
  fireEvent.click(screen.getByText("Save + re-up"));

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(sent(fetchMock)).toEqual([
    {
      settings: {},
      folders: [
        FORM.folders[0],
        { service: "jellyfin", source: "/srv/media/films", target: "/media/films", writable: false },
      ],
    },
  ]);
});

test("a folder the server would refuse is said before saving", async () => {
  renderForm();

  fireEvent.change(await screen.findByLabelText("Folder 1 on the host"), { target: { value: "~/media" } });
  expect(screen.getByText(/write the full path|\/root/)).toBeInTheDocument();
  expect(screen.getByText("Save + re-up").closest("button")).toBeDisabled();
});

test("an added folder left empty is not a change", async () => {
  renderForm();

  fireEvent.click(await screen.findByText("Add folder"));
  expect(screen.getByText("Save + re-up").closest("button")).toBeDisabled();
  expect(screen.getByText("Edit as text").closest("button")).toBeEnabled();
});

test("Edit as text carries the form's unsaved changes over, as unsaved edits", async () => {
  const { fetchMock } = renderForm();

  fireEvent.change(await screen.findByLabelText("Host port"), { target: { value: "9000" } });
  fireEvent.click(screen.getByText("Edit as text"));

  fireEvent.click(await screen.findByRole("tab", { name: /^\.env/ }));
  expect(screen.getByLabelText(".env")).toHaveValue('PORT="9000"\n');
  // Previewed, not saved: the tab is marked unsaved.
  expect(screen.getByRole("tab", { name: /^\.env/ })).toHaveTextContent("•");
  expect(sent(fetchMock)).toEqual([{ settings: { PORT: "9000" }, preview: true }]);
});
