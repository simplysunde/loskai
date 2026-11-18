import { expect, test } from "vitest";

import { urlToUpstream, urlUsesTls } from "./networkServices";

test("an AdGuard URL with a port is that host and port", () => {
  expect(urlToUpstream("http://192.168.10.230:3000")).toBe("192.168.10.230:3000");
  expect(urlUsesTls("http://192.168.10.230:3000")).toBe(false);
});

test("an AdGuard URL without a port gets the one its scheme implies", () => {
  expect(urlToUpstream("http://192.168.10.230")).toBe("192.168.10.230:80");
  expect(urlToUpstream("https://adguard.lan/")).toBe("adguard.lan:443");
  expect(urlUsesTls("https://adguard.lan/")).toBe(true);
});

test("no URL, or not one, is nothing", () => {
  expect(urlToUpstream(null)).toBe("");
  expect(urlToUpstream("not a url")).toBe("");
  expect(urlUsesTls(undefined)).toBe(false);
});
