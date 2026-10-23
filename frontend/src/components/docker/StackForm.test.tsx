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
  options: [{ id: "hwaccel", label: "Hardware transcoding", help: "Needs /dev/dri", on: false }],
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
        : path.endsWith("/form") && init?.method === "POST"
          ? { ...form, settings: [{ ...form.settings[0], value: "9100" }, ...form.settings.slice(1)] }
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
  expect(screen.getByText("Save").closest("button")).toBeDisabled();
});

test("saving sends only the changed values, and the folders when they changed", async () => {
  const { fetchMock, onClose } = renderForm();

  fireEvent.change(await screen.findByLabelText("Host port"), { target: { value: "9000" } });
  fireEvent.click(screen.getByText("Save"));
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
  fireEvent.click(screen.getByText("Save"));

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
  expect(screen.getByText("Save").closest("button")).toBeDisabled();
});

test("an added folder left empty is not a change", async () => {
  renderForm();

  fireEvent.click(await screen.findByText("Add folder"));
  expect(screen.getByText("Save").closest("button")).toBeDisabled();
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

test("Edit as form carries the text's unsaved changes back, and saves on top of them", async () => {
  const { fetchMock, onClose } = renderForm();

  fireEvent.click(await screen.findByText("Edit as text"));
  fireEvent.click(await screen.findByRole("tab", { name: /^\.env/ }));
  fireEvent.change(screen.getByLabelText(".env"), { target: { value: 'PORT="9100"\n' } });
  fireEvent.click(screen.getByText("Edit as form"));

  expect(await screen.findByLabelText("Host port")).toHaveValue("9100");
  const read = fetchMock.mock.calls.find(([p, i]) => p.endsWith("/form") && i?.method === "POST");
  expect(JSON.parse(String(read![1]!.body))).toEqual({ env: 'PORT="9100"\n', override: "" });

  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(sent(fetchMock)).toEqual([{ settings: {}, base: { env: 'PORT="9100"\n', override: "" } }]);
});

test("an unsaved compose.yml keeps you in the text view", async () => {
  renderForm();

  fireEvent.click(await screen.findByText("Edit as text"));
  fireEvent.change(await screen.findByLabelText("compose.yml"), { target: { value: "services: {}\n" } });
  expect(screen.getByText("Edit as form").closest("button")).toBeDisabled();
});

test("an option is a checkbox, and switching it sends only that change", async () => {
  const { fetchMock, onClose } = renderForm();

  const gpu = await screen.findByRole("checkbox", { name: /Hardware transcoding/ });
  expect(gpu).not.toBeChecked();
  fireEvent.click(gpu);
  fireEvent.click(screen.getByText("Save"));

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(sent(fetchMock)).toEqual([{ settings: {}, options: { hwaccel: true } }]);
});

test("after a save whose up failed, undoing the change can be saved", async () => {
  // The server remembers what was saved, and `up` fails — a GPU the host doesn't have.
  let on = false;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT") on = JSON.parse(String(init.body)).options?.hwaccel ?? on;
    const body = path.endsWith("/action")
      ? { ok: false, output: "error gathering device information" }
      : init?.method === "PUT"
        ? { ok: true }
        : { ...FORM, options: [{ ...FORM.options[0], on }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <StackEditor name="jellyfin" onClose={vi.fn()} />
    </QueryClientProvider>,
  );

  fireEvent.click(await screen.findByRole("checkbox", { name: /Hardware transcoding/ }));
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText("error gathering device information")).toBeInTheDocument();

  // The form now reads what was saved, so unticking is a change again.
  await waitFor(() => expect(screen.getByText("Save").closest("button")).toBeDisabled());
  fireEvent.click(screen.getByRole("checkbox", { name: /Hardware transcoding/ }));
  expect(screen.getByText("Save").closest("button")).toBeEnabled();
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(sent(fetchMock)).toEqual([{ settings: {}, options: { hwaccel: true } }, { settings: {}, options: { hwaccel: false } }]));
});

test("a read-back after a failed up that fails says so", async () => {
  let loads = 0;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/form") && !init?.method) {
      loads += 1;
      if (loads > 1) return new Response(JSON.stringify({ detail: "disk gone" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    const body = path.endsWith("/action") ? { ok: false, output: "up failed" } : init?.method === "PUT" ? { ok: true } : FORM;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <StackEditor name="jellyfin" onClose={vi.fn()} />
    </QueryClientProvider>,
  );

  fireEvent.click(await screen.findByRole("checkbox", { name: /Hardware transcoding/ }));
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText(/Couldn't read the stack back: disk gone/)).toBeInTheDocument();
});

test("a save that closes the editor reads nothing back", async () => {
  const onClose = vi.fn();
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const body = path.endsWith("/action") ? { ok: true, output: "" } : init?.method === "PUT" ? { ok: true } : FORM;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <StackEditor name="jellyfin" onClose={onClose} />
    </QueryClientProvider>,
  );

  fireEvent.click(await screen.findByRole("checkbox", { name: /Hardware transcoding/ }));
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const formGets = fetchMock.mock.calls.filter(([p, i]) => String(p).endsWith("/form") && !i?.method);
  expect(formGets).toHaveLength(1);
});

test("a save whose up couldn't run reads the stack back too", async () => {
  // The files are written, then `up` itself errors (no docker CLI, a timeout).
  let on = false;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT") on = JSON.parse(String(init.body)).options?.hwaccel ?? on;
    if (path.endsWith("/action"))
      return new Response(JSON.stringify({ detail: "docker CLI not found in the container" }), { status: 400, headers: { "Content-Type": "application/json" } });
    const body = init?.method === "PUT" ? { ok: true } : { ...FORM, options: [{ ...FORM.options[0], on }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <StackEditor name="jellyfin" onClose={vi.fn()} />
    </QueryClientProvider>,
  );

  fireEvent.click(await screen.findByRole("checkbox", { name: /Hardware transcoding/ }));
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText("docker CLI not found in the container")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("Save").closest("button")).toBeDisabled());
  fireEvent.click(screen.getByRole("checkbox", { name: /Hardware transcoding/ }));
  expect(screen.getByText("Save").closest("button")).toBeEnabled();
});
