import { expect, test } from "vitest";

import { containerPrefill, suggestPrefix } from "./containerPrefill";

// Both route forms read this, so these are the pre-fills a user sees either way.

test("a full suggestion is used as it is", () => {
  expect(
    containerPrefill({
      name: "whoami-whoami-1",
      suggested_upstream: "192.168.10.220:8081",
      suggested_host: "192.168.10.220",
      instance_id: "whoami",
    }),
  ).toEqual({ prefix: "whoami", upstream: "192.168.10.220:8081" });
});

test("a known host with an unknown port leaves only the port to type", () => {
  expect(
    containerPrefill({ name: "x", suggested_upstream: null, suggested_host: "192.168.10.220" }).upstream,
  ).toBe("192.168.10.220:");
});

test("nothing known pre-fills nothing, rather than a bare colon", () => {
  expect(containerPrefill({ name: "x", suggested_upstream: null, suggested_host: null }).upstream).toBe("");
  // An older backend that sends neither field.
  expect(containerPrefill({ name: "x" }).upstream).toBe("");
});

test("the prefix prefers the linked instance's id over the generated container name", () => {
  expect(containerPrefill({ name: "bambuddy-bambuddy-1", instance_id: "bambuddy" }).prefix).toBe("bambuddy");
  expect(containerPrefill({ name: "My_App.1" }).prefix).toBe(suggestPrefix("My_App.1"));
});

test("suggestPrefix makes a container name a valid label", () => {
  expect(suggestPrefix("My_App.1")).toBe("my-app-1");
  expect(suggestPrefix("--edge--")).toBe("edge");
});
