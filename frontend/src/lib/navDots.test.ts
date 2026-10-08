import { expect, test } from "vitest";

import { navDots } from "./navDots";
import type { HealthMap } from "./useHealth";

const OK: HealthMap = {
  caddy: { status: "healthy" },
  adguard: { status: "healthy" },
  wireguard: { status: "healthy" },
  docker: { status: "healthy" },
  consistency: [],
};
const warn = (id: string, machine: boolean, kind: "dns_missing" | "dns_conflict" = "dns_missing") => ({
  id, domain: `${id}.example.no`, kind, machine, detail: "",
});

test("all well: every dot is green", () => {
  const dots = navDots(OK);
  expect(dots["/routing"]?.state).toBe("healthy");
  expect(dots["/machines"]?.state).toBe("healthy");
});

test("a machine's DNS problem turns Machines amber, not Routing", () => {
  const dots = navDots({ ...OK, consistency: [warn("nas", true), warn("nas", true, "dns_conflict")] });
  expect(dots["/machines"]).toEqual({ state: "degraded", title: "1 machine with a DNS problem" });
  expect(dots["/routing"]?.state).toBe("healthy");
});

test("a route's DNS problem turns Routing amber, not Machines", () => {
  const dots = navDots({ ...OK, consistency: [warn("plex", false), warn("grafana", false)] });
  expect(dots["/routing"]).toEqual({ state: "degraded", title: "2 routes with a DNS problem" });
  expect(dots["/machines"]?.state).toBe("healthy");
});

test("AdGuard down still wins over a DNS warning", () => {
  const dots = navDots({ ...OK, adguard: { status: "unreachable" }, consistency: [warn("nas", true)] });
  expect(dots["/machines"]).toEqual({ state: "unreachable", title: "AdGuard: unreachable" });
});
