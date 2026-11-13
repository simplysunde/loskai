import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { StackEditor } from "./StackEditor";
import { renderWithQuery, json } from "../../test/render";

const COMPOSE = "services:\n  jellyfin:\n    image: jellyfin/jellyfin:12.2\n";
const OVERRIDE = "services:\n  jellyfin:\n    volumes:\n      - /srv/films:/media/films\n";
const FORM = {
  settings: [{ key: "PORT", label: "Host port", value: "8096", default: "8096" }],
  folders: [{ service: "jellyfin", source: "/srv/films", target: "/media/films", writable: true }],
  override_other: false,
  override_comments: false,
  services: ["jellyfin"],
  app: [{ service: "jellyfin", image: "jellyfin/jellyfin:12.2", network: null, ports: ["8096 → 8096"], volumes: [] }],
  recipe: { id: "jellyfin", name: "Jellyfin", icon: false },
  options: [{ id: "hwaccel", label: "Hardware transcoding", help: "Needs /dev/dri", on: false }],
};

// The text view, behind the form's Edit as text: every file has its tab, only what changed
// is saved, the stack is re-upped, and a refusal — the server's or Compose's — lands where
// it can be fixed.
async function renderEditor({
  override = OVERRIDE as string | null,
  put = (_file: string) => new Response("{}", { status: 200 }),
  up = { ok: true, output: "Started" },
} = {}) {
  const onClose = vi.fn();
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT") return put(JSON.parse(String(init.body)).file);
    const body = path.endsWith("/action")
      ? up
      : path.endsWith("/form")
        ? FORM
        : {
          compose: COMPOSE,
          compose_file: "compose.yml",
          env: 'PORT="8096"\n',
          override,
          override_file: override === null ? null : "compose.override.yml",
          services: ["jellyfin"],
        };
    return json(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderWithQuery(<StackEditor name="jellyfin" onClose={onClose} />);
  fireEvent.click(await screen.findByText("Edit as text"));
  return { fetchMock, onClose };
}

const calls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method)
    .map(([path, init]) => `${init.method} ${path} ${init.method === "PUT" ? JSON.parse(init.body).file : ""}`.trim());


test("each file has a tab, and the override's can be edited", async () => {
  const { fetchMock, onClose } = await renderEditor();

  fireEvent.click(await screen.findByRole("tab", { name: "compose.override.yml" }));
  const editor = screen.getByLabelText("compose.override.yml");
  expect(editor).toHaveValue(OVERRIDE);
  fireEvent.change(editor, { target: { value: OVERRIDE + "      - /srv/music:/media/music\n" } });
  fireEvent.click(screen.getByText("Save"));

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  // Only the changed file is written, and the stack is re-upped so it takes effect.
  expect(calls(fetchMock)).toEqual([
    "PUT /api/docker/stacks/jellyfin/file compose.override.yml",
    "POST /api/docker/stacks/jellyfin/action",
  ]);
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
    "compose.yml",
    ".env",
    "compose.override.yml",
  ]);
});

test("a stack without an override offers one, with an example to start from", async () => {
  await renderEditor({ override: null });

  fireEvent.click(await screen.findByRole("tab", { name: "compose.override.yml" }));
  expect(screen.getByLabelText("compose.override.yml")).toHaveValue("");
  expect(screen.getByLabelText("compose.override.yml")).toHaveAttribute(
    "placeholder",
    expect.stringContaining("  jellyfin:\n    volumes:\n      - /host/folder:"),
  );
});

test("a file the server refuses opens its tab and says why", async () => {
  const { onClose } = await renderEditor({
    put: () =>
      json({ detail: "compose.override.yml line 4: indented with a tab — YAML needs spaces" }, 400),
  });

  fireEvent.click(await screen.findByRole("tab", { name: "compose.override.yml" }));
  fireEvent.change(screen.getByLabelText("compose.override.yml"), { target: { value: "services:\n\tx: {}\n" } });
  fireEvent.click(screen.getByRole("tab", { name: "compose.yml" }));
  fireEvent.click(screen.getByText("Save"));

  expect(await screen.findByText(/line 4: indented with a tab/)).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /compose\.override\.yml/ })).toHaveAttribute("aria-selected", "true");
  expect(onClose).not.toHaveBeenCalled();
});

test("when Compose refuses the saved stack, the dialog stays open on its output", async () => {
  const { onClose } = await renderEditor({ up: { ok: false, output: "invalid mount config: bind source path does not exist" } });

  fireEvent.click(await screen.findByRole("tab", { name: ".env" }));
  fireEvent.change(screen.getByLabelText(".env"), { target: { value: 'PORT="9000"\n' } });
  fireEvent.click(screen.getByText("Save"));

  expect(await screen.findByText(/bind source path does not exist/)).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

test("a new stack whose up fails stays open on what Compose said", async () => {
  const onClose = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ ok: false, output: "service \"app\" has neither an image nor a build context" })),
  );
  renderWithQuery(<StackEditor name={null} onClose={onClose} />);

  fireEvent.change(screen.getByPlaceholderText("stack name"), { target: { value: "scratch" } });
  fireEvent.click(screen.getByText("Create + up"));

  expect(await screen.findByText(/neither an image nor a build context/)).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

test("Tab types spaces, and Enter keeps the indent — one deeper after a key", async () => {
  await renderEditor({ override: null });
  fireEvent.click(await screen.findByRole("tab", { name: "compose.override.yml" }));
  const editor = screen.getByLabelText("compose.override.yml") as HTMLTextAreaElement;

  fireEvent.change(editor, { target: { value: "services:" } });
  editor.setSelectionRange(9, 9);
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(editor).toHaveValue("services:\n  ");

  editor.setSelectionRange(12, 12);
  fireEvent.keyDown(editor, { key: "Tab" });
  expect(editor).toHaveValue("services:\n    ");
});
