import { expect, test } from "vitest";

import { groupByStack, groupStatus, type Container, type Stack } from "./groupByStack";

function c(name: string, project: string | null = null): Container {
  return {
    id: name, name, image: `${name}/img`, project, status: "running", uptime: 1, ports: [],
    subdomain: null, suggested_upstream: null, cpu: null, mem: null,
  };
}
function s(name: string, status: Stack["status"] = "up"): Stack {
  return { name, services: [], status };
}

const CONTAINERS = [
  c("portainer"),
  c("adminer"),
  c("immich-server", "immich"),
  c("loskai", "loskai"),
  c("immich-db", "immich"),
  c("jellyfin", "jellyfin"),
];
const STACKS = [s("immich", "partial"), s("jellyfin"), s("paperless", "down")];

test("containers nest under their stack, other projects next, each lone container last", () => {
  const groups = groupByStack(CONTAINERS, STACKS);

  expect(groups.map((g) => g.key)).toEqual([
    "stack:immich",
    "stack:jellyfin",
    "stack:paperless",
    "project:loskai",
    // A group of one each, by name — not one shared bucket.
    "standalone:adminer",
    "standalone:portainer",
  ]);
  expect(groups[0].containers.map((x) => x.name)).toEqual(["immich-db", "immich-server"]);
});

test("a stack with no containers still has its group", () => {
  // Down and never created: its actions (Up, Edit) must still be reachable.
  const paperless = groupByStack(CONTAINERS, STACKS).find((g) => g.key === "stack:paperless");
  expect(paperless?.containers).toEqual([]);
});

test("no container is lost or listed twice", () => {
  const listed = groupByStack(CONTAINERS, STACKS).flatMap((g) => g.containers.map((x) => x.name));
  expect(listed.sort()).toEqual(CONTAINERS.map((x) => x.name).sort());
});

test("with nothing loose, there are no standalone groups", () => {
  const groups = groupByStack([c("a", "jellyfin")], [s("jellyfin")]);
  expect(groups.map((g) => g.key)).toEqual(["stack:jellyfin"]);
});

test("Loskai's own container is never grouped", () => {
  const groups = groupByStack([{ ...c("loskai", "loskai"), self: true }, c("a", "jellyfin")], [s("jellyfin")]);
  expect(groups.map((g) => g.key)).toEqual(["stack:jellyfin"]);
});

test("a group's status: up, down, or how many of how many", () => {
  const stopped = { ...c("db", "immich"), status: "exited" };
  const status = (containers: Container[], stack = s("immich", "partial")) =>
    groupStatus({ kind: "stack", key: "k", stack, containers }).label;

  expect(status([c("web", "immich")], s("immich"))).toBe("up");
  expect(status([c("web", "immich"), stopped])).toBe("1/2 up");
  expect(status([stopped], s("immich", "down"))).toBe("down");
  // Declared but never created still counts: everything that exists running isn't "up".
  expect(status([c("web", "immich")], { ...s("immich", "partial"), services: ["web", "db"] })).toBe("1/2 up");
  expect(status([], s("immich", "unknown"))).toBe("unknown");
});
