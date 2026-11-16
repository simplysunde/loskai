// record.mjs — run by scripts/record-demo.sh, in Playwright's image, after setup.mjs. Records
// each flow as a video in /out (name.webm, and the second its action starts in marks.txt,
// so the loading before it is cut).
//
// Playwright draws no cursor, so one is drawn here, and every click first glides to its
// target; a caption at the top says what each step is. A flow is a list of steps a
// person would take — to change one, change its steps (docs/contributing/demo.md).
import fs from "node:fs";
import { chromium, devices } from "playwright";

const BASE = process.env.LOSKAI_URL;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const OUT = "/out";
const SIZE = { width: 1280, height: 720 };

const browser = await chromium.launch();

// The cursor and the caption, drawn on every page the flow opens.
function overlay() {
  const add = () => {
    if (document.getElementById("demo-cursor")) return;
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L9.5 21z" fill="#fff" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    Object.assign(cursor.style, {
      position: "fixed", left: "-40px", top: "-40px", zIndex: 2147483647, pointerEvents: "none",
      filter: "drop-shadow(0 1px 2px rgba(0,0,0,.5))", transition: "transform .12s",
    });
    const caption = document.createElement("div");
    caption.id = "demo-caption";
    Object.assign(caption.style, {
      position: "fixed", left: "50%", top: "12px", transform: "translateX(-50%)", zIndex: 2147483646,
      pointerEvents: "none", padding: "8px 16px", borderRadius: "10px", background: "rgba(2,6,23,.88)",
      color: "#e2e8f0", font: "500 16px system-ui, sans-serif", border: "1px solid rgba(45,212,191,.45)",
      maxWidth: "90vw", whiteSpace: "nowrap", opacity: "0", transition: "opacity .25s",
    });
    document.body.append(cursor, caption);
    addEventListener("mousemove", (e) => { cursor.style.left = `${e.clientX - 3}px`; cursor.style.top = `${e.clientY - 2}px`; }, true);
    addEventListener("mousedown", () => { cursor.style.transform = "scale(.8)"; }, true);
    addEventListener("mouseup", () => { cursor.style.transform = ""; }, true);
  };
  if (document.body) add();
  else addEventListener("DOMContentLoaded", add);
}

async function newContext({ login = true, ...options } = {}) {
  const ctx = await browser.newContext({
    viewport: SIZE, recordVideo: { dir: `${OUT}/raw`, size: options.viewport || SIZE },
    ignoreHTTPSErrors: true, colorScheme: "dark", extraHTTPHeaders: { Origin: BASE }, ...options,
  });
  ctx.setDefaultTimeout(30000);
  await ctx.addInitScript(overlay);
  if (!login) return ctx;
  // The context's API calls share its cookies: logging in here logs the page in.
  const r = await ctx.request.post(`${BASE}/api/login`, { data: { username: "admin", password: process.env.LOSKAI_PASSWORD } });
  if (!r.ok()) throw new Error(`login: ${r.status()}`);
  return ctx;
}

const pause = (p, ms) => p.waitForTimeout(ms);
async function caption(p, text) {
  await p.evaluate((t) => {
    const c = document.getElementById("demo-caption");
    if (!c) return;
    c.textContent = t;
    c.style.opacity = t ? "1" : "0";
  }, text);
}
// Glide to the target, then click it — as a hand would.
async function click(p, locator) {
  await locator.waitFor({ state: "visible" });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await pause(p, 250);
  await locator.click();
  await pause(p, 400);
}
async function type(p, locator, text) {
  await click(p, locator);
  await locator.fill("");
  await locator.pressSequentially(text, { delay: 90 });
}
async function go(p, path) {
  await p.goto(path.startsWith("http") ? path : `${BASE}${path}`);
  await p.waitForLoadState("networkidle").catch(() => {});
  await pause(p, 800);
}
const dialog = (p) => p.getByRole("dialog").last();
// A tab, opened from the sidebar as a person would: the page never reloads.
const tab = (p, name) => p.getByRole("navigation").getByRole("link", { name }).first();
// Rest the cursor on something, to point at it.
async function point(p, locator) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
}

const marks = [];
async function record(name, flow, options) {
  if (ONLY && !ONLY.test(name)) return;
  const ctx = await newContext(options);
  const p = await ctx.newPage();
  const opened = Date.now();
  let started = 0;
  try {
    await flow(p, () => { started = (Date.now() - opened) / 1000; });
  } catch (e) {
    await p.screenshot({ path: `${OUT}/${name}-failed.png` }).catch(() => {});
    throw new Error(`${name}: ${e.message.split("\n")[0]} (the page as it was: .demo/out/${name}-failed.png)`);
  }
  const video = p.video();
  await ctx.close();
  await video.saveAs(`${OUT}/${name}.webm`);
  marks.push(`${name} ${started.toFixed(2)}`);
  console.log(`✓ recorded ${name}`);
}

// Routing: from the dashboard, a container gets its name in one step — and its card is on
// the dashboard. It stays in Loskai throughout: what the app behind the name looks like is
// that app's to show.
await record("routing", async (p, start) => {
  await go(p, "/");
  start();
  await caption(p, "Your homelab — every service, one click away");
  const cards = p.getByRole("main").getByRole("link");
  for (const card of (await cards.all()).slice(0, 3)) {
    await point(p, card);
    await pause(p, 450);
  }
  await pause(p, 800);
  await click(p, tab(p, "Routing"));
  await caption(p, "Routing — give a service a name of its own");
  await pause(p, 1500);
  await click(p, p.getByRole("button", { name: "Add route" }).first());
  await caption(p, "Add route → pick a container");
  await click(p, dialog(p).getByText("jellyfin-jellyfin-1"));
  await caption(p, "One step: Caddy's route and AdGuard's DNS name");
  await pause(p, 1500);
  await click(p, dialog(p).getByRole("button", { name: "Add route" }));
  await dialog(p).waitFor({ state: "detached" });
  await p.getByText("jellyfin.home.lan").first().waitFor();
  await caption(p, "https://jellyfin.home.lan — routed, and in DNS");
  await pause(p, 2200);
  await click(p, tab(p, "Dashboard"));
  const jellyfin = cards.filter({ hasText: "Jellyfin" });
  await point(p, jellyfin);
  await caption(p, "…and on the dashboard, for everyone at home");
  await pause(p, 3200);
});

// Docker: an app installed from its recipe, and routed from the wizard's last step.
await record("docker", async (p, start) => {
  await go(p, "/docker");
  start();
  await caption(p, "Docker — every stack and its containers");
  await pause(p, 2000);
  await click(p, p.getByRole("button", { name: "Install recipe" }));
  await caption(p, "Install an app from a recipe");
  await pause(p, 1200);
  await click(p, dialog(p).getByRole("button", { name: /Forgejo/ }));
  await pause(p, 1500);
  await click(p, dialog(p).getByRole("button", { name: "Continue" }));
  await caption(p, "Its settings, with defaults");
  await pause(p, 1500);
  await click(p, dialog(p).getByRole("button", { name: "Deploy", exact: true }));
  await caption(p, "Installing…");
  await dialog(p).getByText("Route it").waitFor({ timeout: 180000 });
  await caption(p, "Installed — and routed from the same dialog");
  await pause(p, 1200);
  await click(p, dialog(p).getByRole("button", { name: "Add route" }));
  await pause(p, 2500);
  await click(p, dialog(p).getByRole("button", { name: "Done", exact: true }).last());
  await caption(p, "Forgejo, running at https://git.home.lan");
  await pause(p, 3000);
});

// Machines: a machine's dialog — its overview, and a terminal on it in the browser.
await record("machines", async (p, start) => {
  const r = await p.context().request.post(`${BASE}/api/ssh/unlock`, { data: { password: process.env.LOSKAI_PASSWORD } });
  if (!r.ok()) throw new Error(`unlock: ${r.status()}`);
  await go(p, "/machines");
  start();
  await caption(p, "Machines — your computers by name, and what runs on them");
  await pause(p, 2500);
  await click(p, p.getByRole("row").filter({ hasText: "nas.home.lan" }).getByTitle(/^Machine settings/));
  await caption(p, "Over SSH: its overview — system, memory, disks, updates");
  await pause(p, 3000);
  await click(p, dialog(p).getByRole("button", { name: "Terminal" }));
  await caption(p, "A terminal on it, in the browser");
  await pause(p, 2500);
  await p.keyboard.type("df -h /", { delay: 110 });
  await p.keyboard.press("Enter");
  await pause(p, 3500);
});

// The dashboard: every service as a card, as anyone on the LAN sees it, without logging in
// — on a computer, then a phone.
await record("dashboard", async (p, start) => {
  await go(p, "/");
  start();
  await caption(p, "The dashboard — every service, no login needed");
  await pause(p, 2000);
  for (const card of (await p.getByRole("main").getByRole("link").all()).slice(0, 4)) {
    const box = await card.boundingBox();
    if (box) await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
    await pause(p, 500);
  }
  await pause(p, 1500);
}, { login: false });
await record("dashboard-phone", async (p, start) => {
  await go(p, "/");
  start();
  await pause(p, 3000);
}, { ...devices["Pixel 7"], login: false });

// Merged with an earlier run's, so ONLY rerecords some flows and keeps the others' marks.
const earlier = fs.existsSync(`${OUT}/marks.txt`) ? fs.readFileSync(`${OUT}/marks.txt`, "utf8").split("\n") : [];
const fresh = new Set(marks.map((m) => m.split(" ")[0]));
fs.writeFileSync(`${OUT}/marks.txt`, `${[...earlier.filter((m) => m && !fresh.has(m.split(" ")[0])), ...marks].join("\n")}\n`);

await browser.close();
