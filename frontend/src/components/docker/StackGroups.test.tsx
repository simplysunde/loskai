import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { StackGroups } from "./StackGroups";
import { VolumeList } from "./VolumeList";

const container = (name: string, project: string | null, status = "running") => ({
  id: name, name, image: `${name}/img`, project, status, uptime: 60, ports: [],
  subdomain: null, suggested_upstream: null, cpu: 1, mem: { percent: 2 },
});

const RESPONSES: Record<string, unknown> = {
  "/api/docker/containers": [
    { ...container("immich-server", "immich"), subdomain: "photos" },
    container("immich-db", "immich", "exited"),
    { ...container("whoami-whoami-1", "whoami"), subdomain: "whoami" },
    { ...container("other-app", "other"), compose_dir: "/home/someone/other" },
    { ...container("other-worker", "other", "exited"), compose_dir: "/home/someone/other" },
    { ...container("portainer", null), subdomain: "portainer" },
    { ...container("loskai", "loskai"), self: true, subdomain: "loskai" },
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

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      new Response(JSON.stringify(RESPONSES[path] ?? {}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const noop = () => {};
const groups = () =>
  renderWith(
    <StackGroups
      baseDomain="example.no"
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
  expect(screen.getByTitle(/not managed by Loskai/)).toHaveTextContent("Other containers");
});

test("with nothing unmanaged, there is no second table", async () => {
  const containers = RESPONSES["/api/docker/containers"] as { project: string | null }[];
  vi.mocked(fetch).mockImplementation(async (path) => {
    const data =
      path === "/api/docker/containers"
        ? containers.filter((c) => c.project === "immich" || c.project === "whoami")
        : (RESPONSES[String(path)] ?? {});
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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
    return new Response(JSON.stringify(RESPONSES[String(path)] ?? {}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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
    return new Response(JSON.stringify(RESPONSES[String(path)] ?? {}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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
      baseDomain="example.no"
      onLogs={noop}
      onTerminal={noop}
      onRemove={noop}
      onEditStack={noop}
      onDeleteStack={noop}
      onRemoveProject={onRemoveProject}
    />,
  );
  await screen.findByText("other-app");

  expect(within(header("other")).getByRole("img", { name: "Started from /home/someone/other" })).toBeInTheDocument();
  fireEvent.click(within(header("other")).getByRole("button", { name: "Remove containers" }));
  expect(onRemoveProject).toHaveBeenCalledWith(
    expect.objectContaining({ name: "other", containers: expect.arrayContaining([expect.objectContaining({ name: "other-worker" })]) }),
  );
});

test("a lone container is a group of one, laid out like every other group", async () => {
  const onRemove = vi.fn();
  renderWith(
    <StackGroups
      baseDomain="example.no"
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
      baseDomain="example.no"
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
      baseDomain="example.no"
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
