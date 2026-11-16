import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";

import { InstallWizard } from "./InstallWizard";
import { renderWithQuery, json } from "../../test/render";

const GRAFANA = {
  id: "grafana",
  name: "Grafana",
  type: "pull",
  description: "Dashboards",
  env: [
    { key: "PORT", label: "Host port", default: "3000" },
    { key: "DATA", label: "Data folder", type: "path", default: "./data" },
  ],
  suggested_subdomain: "grafana",
  instructions: "# Grafana\nFirst login is admin / admin.\n",
  source: "loskai-recipes",
  source_url: "https://git.example/sunde/loskai-recipes.git",
};

const SOURCES = [
  {
    url: "https://git.example/sunde/loskai-recipes.git",
    label: "loskai-recipes",
    enabled: true,
    builtin: true,
    synced: true,
    count: 1,
  },
];

// The wizard is the only surface that runs an install, and two things it reports are not
// reconstructible from anywhere else: the recipe's own instructions.md, and which copy of
// a duplicated recipe id actually won.
function renderWizard({
  recipes = [GRAFANA] as unknown[],
  invalid = [] as unknown[],
  shadowed = [] as unknown[],
  sources = SOURCES as unknown[],
  local_count = 0,
  install = { ok: true, output: "Started", container: "grafana-app-1" } as unknown,
  refresh = { ok: true, results: [] } as unknown,
  health = {} as unknown,
  settings = { base_domain: { value: "example.no", source: "stored", secret: false } } as unknown,
  containers = [
    { name: "grafana-app-1", instance_id: "grafana", subdomain: null, suggested_upstream: "grafana:3000" },
  ] as unknown[],
} = {}) {
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) => {
    if (path.endsWith("/install") && install instanceof Error) throw install;
    const body = path.endsWith("/install")
      ? install
      : path.endsWith("/refresh")
        ? refresh
      : path === "/api/health"
        ? health
      : path === "/api/docker/containers"
        ? containers
        : path === "/api/settings"
          ? settings
          : path === "/api/routes"
            ? { url: "https://grafana.example.no", warning: null }
          : path === "/api/links"
            ? { url: "http://192.168.10.220:3000", warning: null, link: true }
            : path === "/api/auth/status"
              ? { authed: true, needs_setup: false, user: { username: "admin", level: 4, tabs: ["routing", "docker", "machines"] } }
            : { recipes, invalid, shadowed, sources, local_count };
    return json(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderWithQuery(
    <MemoryRouter>
      <InstallWizard onClose={() => {}} />
    </MemoryRouter>,
  );
  return fetchMock;
}

const pickGrafana = async () => fireEvent.click(await screen.findByText("Grafana"));


test("a recipe with an icon shows it in the catalog; one without keeps its letter", async () => {
  renderWizard({ recipes: [{ ...GRAFANA, icon: true }, { ...GRAFANA, id: "whoami", name: "Whoami" }] });

  const grafana = (await screen.findByText("Grafana")).closest("button")!;
  expect(grafana.querySelector("img")).toHaveAttribute("src", "/api/docker/recipes/grafana/icon");
  const whoami = screen.getByText("Whoami").closest("button")!;
  expect(whoami.querySelector("img")).toBeNull();
  expect(whoami).toHaveTextContent("W");
});

test("the review step shows the recipe's instructions before the form", async () => {
  renderWizard();
  await pickGrafana();

  expect(screen.getByText(/First login is admin \/ admin/)).toBeInTheDocument();
  // The form is one step further on — the walk-through comes first.
  expect(screen.queryByText("Host port")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText("Host port")).toBeInTheDocument();
});

test("the review step names what the install will create", async () => {
  renderWizard();
  await pickGrafana();

  expect(screen.getByText("grafana/")).toBeInTheDocument();
  expect(screen.getByText("./data")).toBeInTheDocument();
  expect(screen.getByText(/— in its own folder/)).toBeInTheDocument();
  expect(screen.getByText("PORT, DATA")).toBeInTheDocument();
});

// --- type: path — the wizard says where a mounted folder lands ---

async function fillStep() {
  renderWizard();
  await pickGrafana();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}
const dataField = () => screen.getByLabelText(/Data folder/) as HTMLInputElement;
const setData = (value: string) => fireEvent.change(dataField(), { target: { value } });
const deploy = () => screen.getByRole("button", { name: "Deploy" });

test("a relative path lands beside the compose file, kept on Delete", async () => {
  await fillStep();

  expect(dataField()).toHaveValue("./data");
  expect(screen.getByText(/In its own folder: stacks\/grafana\/data/)).toBeInTheDocument();
  expect(screen.getByText(/Kept when the stack is deleted/)).toBeInTheDocument();
  expect(deploy()).toBeEnabled();
});

test("an absolute path is on the host, and never Loskai's to delete", async () => {
  await fillStep();
  setData("/srv/grafana");

  expect(screen.getByText(/On the Docker host. Loskai never deletes it/)).toBeInTheDocument();
  expect(deploy()).toBeEnabled();
});

test.each([
  ["~/grafana", /container's home \(\/root\)/],
  ["grafana", /a bare 'grafana' is a Docker volume/],
  ["/srv/a:b", /split the volume spec/],
])("%s is refused before Deploy, with the reason", async (value, reason) => {
  await fillStep();
  setData(value);

  expect(screen.getByText(reason)).toBeInTheDocument();
  expect(deploy()).toBeDisabled();
});

test("a cleared path is required", async () => {
  await fillStep();
  setData("");

  expect(screen.getByText(/Required — the folder to mount/)).toBeInTheDocument();
  expect(deploy()).toBeDisabled();
});

test("a shadowed recipe says which source lost and which won", async () => {
  renderWizard({
    shadowed: [{ id: "grafana", source: "local", shadowed_by: "loskai-recipes" }],
  });

  expect(
    await screen.findByText(/grafana \(local copy hidden by loskai-recipes\)/),
  ).toBeInTheDocument();
});

test("an invalid recipe reports why it was skipped", async () => {
  renderWizard({ invalid: [{ id: "broken", source: "local", error: "compose.yml missing" }] });

  expect(await screen.findByText(/broken — compose.yml missing/)).toBeInTheDocument();
});

test("no sources and no recipes points at the settings page", async () => {
  renderWizard({ recipes: [], sources: [] });

  expect(await screen.findByText(/No recipe sources are enabled/)).toBeInTheDocument();
});

test("a configured but never-synced source says to sync, not to add one", async () => {
  renderWizard({
    recipes: [],
    sources: [{ ...SOURCES[0], synced: false, count: 0 }],
  });

  expect(await screen.findByText(/loskai-recipes has never synced/)).toBeInTheDocument();
});

test("an install that cannot identify its container surfaces the warning", async () => {
  renderWizard({
    install: {
      ok: true,
      output: "Started",
      container: null,
      warning: "'Grafana' is up, but its container could not be identified — route it from the Routing tab's Add route picker.",
    },
  });
  await pickGrafana();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Deploy" }));

  expect(await screen.findByText(/could not be identified/)).toBeInTheDocument();
});

test("a failed install offers no route", async () => {
  renderWizard({ install: { ok: false, output: "port is allocated", container: null } });
  await pickGrafana();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Deploy" }));

  await waitFor(() => expect(screen.getByText(/Finished with errors/)).toBeInTheDocument());
  expect(screen.queryByText("Route it")).not.toBeInTheDocument();
  // The output is what explains a failure, so it starts open.
  expect(screen.getByText("port is allocated")).toBeVisible();
});

test("an install that can't reach Loskai says so", async () => {
  renderWizard({ install: new TypeError("Failed to fetch") });
  await pickGrafana();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Deploy" }));

  expect(await screen.findByText("Install failed")).toBeInTheDocument();
});

const refreshes = (fetchMock: ReturnType<typeof renderWizard>) =>
  fetchMock.mock.calls.filter(([path]) => String(path).endsWith("/recipes/refresh")).length;

// A new install's catalog was empty until someone found Refresh recipes.
test("a source that has never synced is fetched when the catalog opens, once", async () => {
  const fetchMock = renderWizard({
    recipes: [],
    sources: [{ ...SOURCES[0], synced: false, count: 0 }],
  });

  await waitFor(() => expect(refreshes(fetchMock)).toBe(1));
  // Still unsynced afterwards (the source is unreachable, say): it says so, and doesn't loop.
  expect(await screen.findByText(/loskai-recipes has never synced/)).toBeInTheDocument();
  expect(refreshes(fetchMock)).toBe(1);
});

test("a synced source is fetched only by Refresh recipes", async () => {
  const fetchMock = renderWizard();

  await screen.findByText("Grafana");
  expect(refreshes(fetchMock)).toBe(0);
});

test("Refresh recipes says which source failed to sync", async () => {
  renderWizard({
    refresh: {
      ok: false,
      results: [{ url: "https://example.invalid/x.git", label: "x", ok: false, output: "could not resolve host" }],
    },
  });
  fireEvent.click(await screen.findByRole("button", { name: /Refresh recipes/ }));

  expect(await screen.findByText("x failed — the last sync still applies.")).toBeInTheDocument();
});

// --- Phase 30d: the catalog, the steps, and routing from the last one ---

const JELLYFIN_ONLY = {
  id: "jellyfin", name: "Jellyfin", type: "pull", description: "Media server", env: [],
  instructions: "", source: "loskai-recipes",
};

test("search filters the catalog by name or description", async () => {
  renderWizard({ recipes: [GRAFANA, JELLYFIN_ONLY] });
  await screen.findByText("Grafana");

  fireEvent.change(screen.getByRole("textbox", { name: "Search recipes" }), { target: { value: "media" } });
  expect(screen.queryByText("Grafana")).not.toBeInTheDocument();
  expect(screen.getByText("Jellyfin")).toBeInTheDocument();

  fireEvent.change(screen.getByRole("textbox", { name: "Search recipes" }), { target: { value: "zzz" } });
  expect(screen.getByText(/No recipe matches/)).toBeInTheDocument();
});

test("the steps say where you are, and an earlier one takes you back", async () => {
  renderWizard();
  await pickGrafana();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  expect(screen.getByRole("button", { name: /Configure/ })).toHaveAttribute("aria-current", "step");
  fireEvent.click(screen.getByRole("button", { name: /Choose/ }));
  expect(await screen.findByRole("textbox", { name: "Search recipes" })).toBeInTheDocument();
});

async function deployGrafana() {
  await pickGrafana();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
}

test("the last step routes the install: its suggested name, following its container", async () => {
  const fetchMock = renderWizard();
  await deployGrafana();

  expect(await screen.findByRole("textbox", { name: "Subdomain prefix" })).toHaveValue("grafana");
  // Once routed, there is no going back to change the answers.
  expect(screen.getByRole("button", { name: /Configure/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Add route" }));

  expect(await screen.findByRole("link", { name: "https://grafana.example.no" })).toBeInTheDocument();
  const post = fetchMock.mock.calls.find(([path]) => path === "/api/routes");
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({
    prefix: "grafana",
    upstream: "grafana:3000",
    container: "grafana-app-1",
    follow_container: true,
  });
});

test("a reinstall that kept its route says so instead of offering another", async () => {
  renderWizard({
    containers: [
      // An http route: where it opens is the server's url, scheme and all.
      { name: "grafana-app-1", instance_id: "grafana", subdomain: "graf", suggested_upstream: "grafana:3000", url: "http://graf.example.no" },
    ],
  });
  await deployGrafana();

  expect(await screen.findByRole("link", { name: "graf.example.no" })).toHaveAttribute("href", "http://graf.example.no");
  expect(screen.queryByRole("button", { name: "Add route" })).not.toBeInTheDocument();
});

test("a container whose port Docker can't name is sent to the Routing tab", async () => {
  renderWizard({
    containers: [{ name: "grafana-app-1", instance_id: "grafana", subdomain: null, suggested_upstream: null }],
  });
  await deployGrafana();

  expect(await screen.findByRole("link", { name: "Routing tab" })).toHaveAttribute("href", "/routing");
  expect(screen.queryByRole("button", { name: "Add route" })).not.toBeInTheDocument();
});

test("an install that reused a kept folder says so", async () => {
  renderWizard({
    install: { ok: true, output: "Started", container: "grafana-app-1", reused_data: true },
  });
  await pickGrafana();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Deploy" }));

  expect(await screen.findByText(/Picked up the data already in its folder/)).toBeInTheDocument();
});

// --- mounts — the folders the user adds, however many they have ---

const JELLYFIN = {
  ...GRAFANA,
  id: "jellyfin",
  name: "Jellyfin",
  env: [],
  mounts: { label: "Media folders", target: "/media", read_only: true },
};

async function jellyfinFill() {
  const fetchMock = renderWizard({ recipes: [JELLYFIN] });
  fireEvent.click(await screen.findByText("Jellyfin"));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  return fetchMock;
}
const folder = (n: number) => screen.getByLabelText(`Media folders ${n}`);
const setFolder = (n: number, value: string) => fireEvent.change(folder(n), { target: { value } });

test("each added folder shows where it lands, and all of them are sent", async () => {
  const fetchMock = await jellyfinFill();
  setFolder(1, "/srv/scloud/media/anime");
  fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
  setFolder(2, "/srv/scloud/media/movies/");
  fireEvent.click(screen.getByRole("button", { name: "Add folder" })); // left blank

  expect(screen.getByText("→ /media/anime, read-only")).toBeInTheDocument();
  expect(screen.getByText("→ /media/movies, read-only")).toBeInTheDocument();

  fireEvent.click(deploy());
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(/install$/),
    expect.anything(),
  ));
  const [, init] = fetchMock.mock.calls.find(([path]) => path.endsWith("/install")) as unknown as [
    string,
    RequestInit,
  ];
  // The blank row is dropped, not sent as an empty folder.
  expect(JSON.parse(String(init.body)).mounts).toEqual([
    "/srv/scloud/media/anime",
    "/srv/scloud/media/movies/",
  ]);
});

test("two folders with one name are refused before Deploy", async () => {
  await jellyfinFill();
  setFolder(1, "/disk1/anime");
  fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
  setFolder(2, "/disk2/anime");

  expect(screen.getAllByText(/Lands at the same place as/)).toHaveLength(2);
  expect(deploy()).toBeDisabled();
});

test("a folder gets the same checks as a path field", async () => {
  await jellyfinFill();
  setFolder(1, "~/anime");

  expect(screen.getByText(/container's home \(\/root\)/)).toBeInTheDocument();
  expect(deploy()).toBeDisabled();
});

test("a removed folder is gone from the form", async () => {
  await jellyfinFill();
  setFolder(1, "/srv/anime");
  fireEvent.click(screen.getByRole("button", { name: "Remove folder" }));

  expect(screen.queryByLabelText("Media folders 1")).not.toBeInTheDocument();
  expect(deploy()).toBeEnabled();
});

// --- options — features switched on at install, off by default ---

test("an option is off until ticked, and only the ticked ones are sent", async () => {
  const fetchMock = renderWizard({
    recipes: [
      {
        ...JELLYFIN,
        mounts: null,
        options: [
          { id: "hwaccel", label: "Hardware transcoding (Intel/AMD)", help: "Needs /dev/dri" },
          { id: "dlna", label: "DLNA", help: null },
        ],
      },
    ],
  });
  fireEvent.click(await screen.findByText("Jellyfin"));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  const gpu = screen.getByRole("checkbox", { name: /Hardware transcoding/ });
  expect(gpu).not.toBeChecked();
  expect(screen.getByText("Needs /dev/dri")).toBeInTheDocument();
  fireEvent.click(gpu);
  fireEvent.click(deploy());

  await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.endsWith("/install"))).toBe(true));
  const [, init] = fetchMock.mock.calls.find(([path]) => path.endsWith("/install")) as unknown as [
    string,
    RequestInit,
  ];
  expect(JSON.parse(String(init.body)).options).toEqual(["hwaccel"]);
});

// A log stream the test feeds by hand: the wizard opens it on the new container.
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }
  close() {}
}

test("the last step shows the newest link the container logs under the recipe's log_link", async () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  renderWizard({ recipes: [{ ...GRAFANA, log_link: "https://login.example.com/" }] });
  await deployGrafana();

  expect(await screen.findByText("Waiting for its link…")).toBeInTheDocument();
  const logs = FakeEventSource.last!;
  expect(logs.url).toBe("/api/docker/containers/grafana-app-1/logs");
  act(() => logs.onmessage!({ data: "\thttps://login.example.com/a/first" }));
  act(() => logs.onmessage!({ data: "visit https://login.example.com.elsewhere.net/a/x or https://elsewhere.net/" }));
  act(() => logs.onmessage!({ data: "To authenticate, visit: https://login.example.com/a/second" }));

  expect(screen.getByRole("link", { name: "https://login.example.com/a/second" })).toHaveAttribute(
    "href",
    "https://login.example.com/a/second",
  );
  expect(screen.queryByText(/elsewhere/)).not.toBeInTheDocument();

  // In JSON, in colour, or ending a sentence: only the address.
  for (const [line, id] of [
    ['{"msg":"visit https://login.example.com/a/json"}', "json"],
    ["visit \x1b[1mhttps://login.example.com/a/colour\x1b[0m now", "colour"],
    ["Visit https://login.example.com/a/stop.", "stop"],
    ["(see https://login.example.com/a/paren)", "paren"],
  ]) {
    act(() => logs.onmessage!({ data: line }));
    expect(screen.getByRole("link")).toHaveAttribute("href", `https://login.example.com/a/${id}`);
  }
});

test("a recipe without a log_link opens no log stream", async () => {
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
  renderWizard();
  await deployGrafana();

  expect(await screen.findByRole("textbox", { name: "Subdomain prefix" })).toBeInTheDocument();
  expect(FakeEventSource.last).toBeNull();
  expect(screen.queryByText("Waiting for its link…")).not.toBeInTheDocument();
});

test("without Caddy set up, the last step offers a link to the Dashboard, not a route", async () => {
  const fetchMock = renderWizard({
    health: { caddy: { status: "unconfigured" } },
    containers: [
      {
        name: "grafana-app-1", instance_id: "grafana", subdomain: null,
        suggested_upstream: "grafana:3000", published_upstream: "192.168.10.220:3000",
      },
    ],
  });
  await deployGrafana();

  expect(await screen.findByText("Put it on the Dashboard")).toBeInTheDocument();
  expect(screen.queryByText("Route it")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Subdomain prefix" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add link" }));

  await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path === "/api/links")).toBe(true));
  const post = fetchMock.mock.calls.find(([path]) => path === "/api/links");
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({
    name: "Grafana", upstream: "192.168.10.220:3000", container: "grafana-app-1", follow_container: true,
  });
});


test("without Caddy or a Docker host IP, the last step says which is missing", async () => {
  renderWizard({
    health: { caddy: { status: "unconfigured" } },
    containers: [{ name: "grafana-app-1", instance_id: "grafana", subdomain: null, published_upstream: null }],
  });
  await deployGrafana();

  expect(await screen.findByText(/doesn't know this host's LAN IP/)).toBeInTheDocument();
  expect(screen.getByText("Docker Host LAN IP")).toBeInTheDocument();
});

test("with the host IP set, a container with no reachable port says so instead", async () => {
  renderWizard({
    health: { caddy: { status: "unconfigured" } },
    settings: {
      base_domain: { value: "example.no", source: "stored", secret: false },
      host_ip: { value: "192.168.10.220", source: "stored", secret: false },
    },
    containers: [{ name: "grafana-app-1", instance_id: "grafana", subdomain: null, published_upstream: null }],
  });
  await deployGrafana();

  expect(await screen.findByText(/no single port a browser can reach/)).toBeInTheDocument();
});
