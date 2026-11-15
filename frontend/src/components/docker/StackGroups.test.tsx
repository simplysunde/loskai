import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { StackGroups } from "./StackGroups";
import { VolumeList } from "./VolumeList";
import { renderWithQuery, json } from "../../test/render";

// immich and whoami are the managed stacks below: the backend names a container's stack.
const container = (name: string, project: string | null, status = "running") => ({
  id: name, name, image: `${name}/img`, project, stack: project === "immich" || project === "whoami" ? project : null,
  status, uptime: 60, ports: [],
  subdomain: null, suggested_upstream: null, cpu: 1, mem: { percent: 2 },
});

const RESPONSES: Record<string, unknown> = {
  "/api/docker/containers": [
    { ...container("immich-server", "immich"), subdomain: "photos", url: "https://photos.example.no" },
    container("immich-db", "immich", "exited"),
    { ...container("whoami-whoami-1", "whoami"), subdomain: "whoami", url: "https://whoami.example.no" },
    { ...container("other-app", "other"), compose_dir: "/home/someone/other" },
    { ...container("other-worker", "other", "exited"), compose_dir: "/home/someone/other" },
    { ...container("portainer", null), subdomain: "portainer", url: "https://portainer.example.no" },
    { ...container("loskai", "loskai"), self: true, subdomain: "loskai", url: "https://loskai.example.no" },
  ],
  "/api/docker/stacks": [
    { name: "immich", services: ["server", "db"], status: "partial" },
    { name: "whoami", services: ["whoami"], status: "up" },
  ],
  "/api/docker/volumes": [
    { name: "immich_pgdata", driver: "local", size: 2048, project: "immich", anonymous: false, used_by: ["immich-db"] },
    { name: "f".repeat(64), driver: "local", size: null, project: null, anonymous: true, used_by: [] },
  ],
};

// Groups start collapsed; most tests look inside them, so they begin with every one open
// — as a session that had opened them would.
const ALL_OPEN = ["stack:immich", "stack:whoami", "project:other", "standalone:portainer"];

beforeEach(() => {
  sessionStorage.setItem("loskai.docker.expanded", JSON.stringify(ALL_OPEN));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      json(RESPONSES[path] ?? {}),
    ),
  );
});
afterEach(() => {
  sessionStorage.clear();
});

function renderWith(ui: React.ReactElement) {
  renderWithQuery(ui);
}

const noop = () => {};
const groups = () =>
  renderWith(
    <StackGroups
      onLogs={noop}
      onTerminal={noop}
      onRemove={noop}
      onEditStack={noop}
      onDeleteStack={noop}
      onRemoveProject={noop}
    />,
  );
const header = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) }).closest("tr")!;

test("a managed stack carries its actions; a project from elsewhere and a lone container don't", async () => {
  groups();
  await screen.findByText("immich-server");

  expect(within(header("immich")).getByTitle("Edit")).toBeInTheDocument();
  expect(within(header("immich")).getByText("1/2 up")).toBeInTheDocument();
  expect(within(header("other")).queryByTitle("Edit")).not.toBeInTheDocument();
  expect(within(header("portainer")).queryByTitle("Edit")).not.toBeInTheDocument();
});

test("stacks and the containers Loskai doesn't manage are separate tables", async () => {
  groups();
  await screen.findByText("immich-server");

  const [stacksTable, othersTable] = screen.getAllByRole("table");
  expect(within(stacksTable).getByText("whoami-whoami-1")).toBeInTheDocument();
  expect(within(stacksTable).queryByText("other-app")).not.toBeInTheDocument();
  expect(within(othersTable).getByText("other-app")).toBeInTheDocument();
  expect(within(othersTable).getByRole("button", { name: "More for portainer" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Other containers" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent(/not managed by Loskai/);
  // A user who already ran these is pointed at how to bring them in.
  const guide = within(othersTable).getByRole("link", { name: "How to bring these into Loskai" });
  expect(guide.getAttribute("href")).toMatch(/docs\/guides\/migration\.md$/);
  expect(within(stacksTable).queryByRole("link", { name: /bring these/ })).not.toBeInTheDocument();
});

test("with nothing unmanaged, there is no second table", async () => {
  const containers = RESPONSES["/api/docker/containers"] as { project: string | null }[];
  vi.mocked(fetch).mockImplementation(async (path) => {
    const data =
      path === "/api/docker/containers"
        ? containers.filter((c) => c.project === "immich" || c.project === "whoami")
        : (RESPONSES[String(path)] ?? {});
    return json(data);
  });
  groups();
  await screen.findByText("immich-server");

  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(screen.queryByText(/Other containers/)).not.toBeInTheDocument();
});

test("start and stop are one toggle: Stop only once everything is up", async () => {
  const calls: { path: string; body: unknown }[] = [];
  vi.mocked(fetch).mockImplementation(async (path, init) => {
    if (init?.method === "POST") calls.push({ path: String(path), body: JSON.parse(String(init.body)) });
    return json(RESPONSES[String(path)] ?? {});
  });
  groups();
  await screen.findByText("immich-server");

  // Half up: Start brings the rest up.
  expect(within(header("immich")).queryByRole("button", { name: "Compose down" })).not.toBeInTheDocument();
  fireEvent.click(within(header("immich")).getByRole("button", { name: "Compose up" }));
  fireEvent.click(within(header("whoami")).getByRole("button", { name: "Compose down" }));

  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(calls).toEqual([
    { path: "/api/docker/stacks/immich/action", body: { action: "up" } },
    { path: "/api/docker/stacks/whoami/action", body: { action: "down" } },
  ]);
});

test("a project from elsewhere gets the toggle too, as plain start/stop per container", async () => {
  // No compose file here to run `compose up` with — so it starts what is stopped.
  const calls: string[] = [];
  vi.mocked(fetch).mockImplementation(async (path, init) => {
    if (init?.method === "POST") calls.push(String(path));
    return json(RESPONSES[String(path)] ?? {});
  });
  groups();
  await screen.findByText("other-app");

  expect(within(header("other")).queryByRole("button", { name: "Stop all" })).not.toBeInTheDocument();
  fireEvent.click(within(header("other")).getByRole("button", { name: "Start all" }));

  await vi.waitFor(() => expect(calls).toEqual(["/api/docker/containers/other-worker/start"]));
});

test("a project from elsewhere says where it was started, and removes its containers", async () => {
  const onRemoveProject = vi.fn();
  renderWith(
    <StackGroups
      onLogs={noop}
      onTerminal={noop}
      onRemove={noop}
      onEditStack={noop}
      onDeleteStack={noop}
      onRemoveProject={onRemoveProject}
    />,
  );
  await screen.findByText("other-app");

  fireEvent.click(within(header("other")).getByRole("button", { name: "Started from /home/someone/other" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Started from /home/someone/other");
  fireEvent.click(within(header("other")).getByRole("button", { name: "Remove containers" }));
  expect(onRemoveProject).toHaveBeenCalledWith(
    expect.objectContaining({ name: "other", containers: expect.arrayContaining([expect.objectContaining({ name: "other-worker" })]) }),
  );
});

test("a lone container is a group of one, laid out like every other group", async () => {
  const onRemove = vi.fn();
  renderWith(
    <StackGroups
      onLogs={noop}
      onTerminal={noop}
      onRemove={onRemove}
      onEditStack={noop}
      onDeleteStack={noop}
      onRemoveProject={noop}
    />,
  );
  await screen.findByText("immich-server");

  // Its header: status, link, toggle, Remove — as a project's.
  const head = header("portainer");
  expect(within(head).getByText("up")).toBeInTheDocument();
  expect(within(head).getByRole("link", { name: "portainer.example.no" })).toBeInTheDocument();
  expect(within(head).getByRole("button", { name: "Stop" })).toBeInTheDocument();
  fireEvent.click(within(head).getByRole("button", { name: "Remove" }));
  expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ name: "portainer" }));
  // Beneath it, the same container row as anywhere else: logs, terminal, a menu.
  const row = screen.getByRole("button", { name: "More for portainer" }).closest("tr")!;
  expect(within(row).getByTitle("Logs")).toBeInTheDocument();
  expect(screen.queryByText("Standalone")).not.toBeInTheDocument();
});

test("links sit on each group's header, never again on the rows beneath", async () => {
  groups();
  await screen.findByText("immich-server");

  expect(within(header("immich")).getByRole("link", { name: "photos.example.no" })).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "photos.example.no" })).toHaveLength(1);
  expect(screen.getAllByRole("link", { name: "portainer.example.no" })).toHaveLength(1);
});

test("a container shows logs and terminal; the rest is behind its menu", async () => {
  const onRemove = vi.fn();
  renderWith(
    <StackGroups
      onLogs={noop}
      onTerminal={noop}
      onRemove={onRemove}
      onEditStack={noop}
      onDeleteStack={noop}
      onRemoveProject={noop}
    />,
  );
  const row = (await screen.findByText("immich-server")).closest("tr")!;

  expect(within(row).getByTitle("Logs")).toBeInTheDocument();
  expect(within(row).queryByTitle("Stop")).not.toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "More for immich-server" }));
  expect(screen.getByRole("menuitem", { name: "Stop" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));

  expect(onRemove).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

test("Loskai's own container sits apart, offering only its logs", async () => {
  const onLogs = vi.fn();
  renderWith(
    <StackGroups
      onLogs={onLogs}
      onTerminal={noop}
      onRemove={noop}
      onEditStack={noop}
      onDeleteStack={noop}
      onRemoveProject={noop}
    />,
  );
  await screen.findByText("immich-server");

  expect(screen.getByText("this app")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "loskai.example.no" })).toBeInTheDocument();
  // Not in the table, and nothing to stop or remove it with.
  expect(document.querySelector("tbody")!.textContent).not.toMatch(/loskai/);
  expect(screen.queryByRole("button", { name: "More for loskai" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("this app").parentElement!.querySelector('[title="Logs"]')!);
  expect(onLogs).toHaveBeenCalledWith(expect.objectContaining({ name: "loskai" }));
});

test("a collapsed group carries its containers' stats in their columns", async () => {
  groups();
  await screen.findByText("immich-server");
  // Open, the header leaves the stat columns to its rows.
  expect(within(header("immich")).queryByText("2.0%")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /^immich/ }));

  // Both fixture containers report 1m, 1% CPU and 2% mem: the longest uptime, the sums.
  const cells = within(header("immich")).getAllByRole("cell");
  expect(cells[1]).toHaveTextContent("1m");
  expect(cells[2]).toHaveTextContent("2.0%");
  expect(cells[3]).toHaveTextContent("4.0%");
});

test("a fresh session starts with every group collapsed; what is opened is remembered", async () => {
  sessionStorage.clear();
  groups();
  await screen.findByRole("button", { name: /^immich/ });
  expect(screen.queryByText("immich-server")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /^immich/ }));
  expect(screen.getByText("immich-server")).toBeInTheDocument();
  expect(JSON.parse(sessionStorage.getItem("loskai.docker.expanded")!)).toEqual(["stack:immich"]);

  // A refresh, or coming back to the tab: the same groups open.
  cleanup();
  groups();
  expect(await screen.findByText("immich-server")).toBeInTheDocument();
  expect(screen.queryByText("whoami-whoami-1")).not.toBeInTheDocument();
});

test("one button per table expands or collapses all of its groups", async () => {
  sessionStorage.clear();
  groups();
  fireEvent.click(await screen.findByRole("button", { name: "Expand all stacks" }));
  expect(screen.getByText("immich-server")).toBeInTheDocument();
  expect(screen.getByText("whoami-whoami-1")).toBeInTheDocument();
  // The other table is left alone.
  expect(screen.queryByText("other-app")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Collapse all stacks" }));
  expect(screen.queryByText("immich-server")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Expand all other containers" }));
  expect(screen.getByText("other-app")).toBeInTheDocument();
});

test("collapsing a stack hides its containers, not the others", async () => {
  groups();
  await screen.findByText("immich-server");

  fireEvent.click(screen.getByRole("button", { name: /^immich/ }));

  expect(screen.queryByText("immich-server")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "More for portainer" })).toBeInTheDocument();
});

test("volumes show what mounts them, and flag the ones nothing does", async () => {
  renderWith(<VolumeList />);

  expect(await screen.findByText("immich_pgdata")).toBeInTheDocument();
  expect(screen.getByText("immich-db")).toBeInTheDocument();
  expect(screen.getByText("unused")).toBeInTheDocument();
  // An anonymous volume's 64-hex name is shortened, and labelled as such.
  expect(screen.getByText(`${"f".repeat(12)}…`)).toBeInTheDocument();
  expect(screen.getByText(/1 unused/)).toBeInTheDocument();
});

test("only an unused volume can be deleted, and only after confirming", async () => {
  const calls: { path: string; method: string }[] = [];
  vi.mocked(fetch).mockImplementation(async (path, init) => {
    calls.push({ path: String(path), method: init?.method ?? "GET" });
    return json(RESPONSES[String(path)] ?? {});
  });
  renderWith(<VolumeList />);
  await screen.findByText("immich_pgdata");

  // Mounted by immich-db: no delete offered at all.
  expect(screen.queryByRole("button", { name: "Delete volume immich_pgdata" })).not.toBeInTheDocument();
  const anon = "f".repeat(64);
  fireEvent.click(screen.getByRole("button", { name: `Delete volume ${anon}` }));
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await vi.waitFor(() =>
    expect(calls).toContainEqual({ path: `/api/docker/volumes/${anon}`, method: "DELETE" }),
  );
});

test("the tables render from the list alone; CPU and memory fill in from their own request", async () => {
  // The list without stats, as the backend now sends it — the stats arrive separately.
  const bare = (RESPONSES["/api/docker/containers"] as Record<string, unknown>[]).map(
    ({ cpu: _cpu, mem: _mem, ...rest }) => rest,
  );
  let releaseStats: () => void = () => {};
  const statsReady = new Promise<void>((resolve) => (releaseStats = resolve));
  vi.mocked(fetch).mockImplementation(async (path) => {
    if (path === "/api/docker/containers/stats") await statsReady;
    const data =
      path === "/api/docker/containers"
        ? bare
        : path === "/api/docker/containers/stats"
          ? { "immich-server": { cpu: 12.5, mem: { percent: 30 } } }
          : (RESPONSES[String(path)] ?? {});
    return json(data);
  });
  groups();

  // Up before the stats answer, with dashes where they will go.
  const row = (await screen.findByText("immich-server")).closest("tr")!;
  expect(within(row).getAllByText("—").length).toBeGreaterThan(0);

  releaseStats();
  expect(await within(row).findByText("12.5%")).toBeInTheDocument();
  expect(within(row).getByText("30.0%")).toBeInTheDocument();
});

test("a compose run that fails says so above the tables, with its output", async () => {
  // The request succeeds — `ok: false` is compose's own failure, which must not read as done.
  vi.mocked(fetch).mockImplementation(async (path, init) => {
    const body = init?.method === "POST"
      ? { ok: false, output: "Error response from daemon: port is already allocated" }
      : (RESPONSES[String(path)] ?? {});
    return json(body);
  });
  groups();
  await screen.findByText("immich-server");

  fireEvent.click(within(header("immich")).getByRole("button", { name: "Compose up" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Couldn't start immich");
  expect(alert).toHaveTextContent("port is already allocated");
  fireEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a container action Loskai refuses says why", async () => {
  vi.mocked(fetch).mockImplementation(async (path, init) =>
    init?.method === "POST"
      ? json({ detail: "Docker is unreachable" }, 502)
      : json(RESPONSES[String(path)] ?? {}),
  );
  groups();
  await screen.findByText("immich-server");

  fireEvent.click(within(header("whoami")).getByRole("button", { name: "Compose down" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't stop whoami");
  expect(screen.getByRole("alert")).toHaveTextContent("Docker is unreachable");
});
