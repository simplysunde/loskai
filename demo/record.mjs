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
function overlay({ touch } = {}) {
  const add = () => {
    if (document.getElementById("demo-cursor")) return;
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L9.5 21z" fill="#fff" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    Object.assign(cursor.style, {
      position: "fixed", left: "-40px", top: "-40px", zIndex: 2147483647, pointerEvents: "none",
      filter: "drop-shadow(0 1px 2px rgba(0,0,0,.5))", transition: "transform .12s",
    });
    // On a phone there is no cursor: a finger is seen only where it taps (`tap`, below).
    if (touch) cursor.style.display = "none";
    const caption = document.createElement("div");
    caption.id = "demo-caption";
    Object.assign(caption.style, {
      position: "fixed", left: "50%", top: "12px", transform: "translateX(-50%)", zIndex: 2147483646,
      pointerEvents: "none", padding: "8px 16px", borderRadius: "10px", background: "rgba(2,6,23,.88)",
      color: "#e2e8f0", font: `500 ${touch ? 14 : 16}px system-ui, sans-serif`, border: "1px solid rgba(45,212,191,.45)",
      maxWidth: "90vw", whiteSpace: "nowrap", opacity: "0", transition: "opacity .25s",
    });
    // A tap: a ring that spreads from where the finger lands, and fades.
    const tap = (x, y) => {
      const ring = document.createElement("div");
      Object.assign(ring.style, {
        position: "fixed", left: `${x - 22}px`, top: `${y - 22}px`, width: "44px", height: "44px",
        borderRadius: "50%", zIndex: 2147483647, pointerEvents: "none",
        background: "rgba(255,255,255,.28)", border: "2px solid rgba(255,255,255,.85)",
      });
      document.body.append(ring);
      ring.animate(
        [{ transform: "scale(.45)", opacity: 1 }, { transform: "scale(1)", opacity: 0.9, offset: 0.35 }, { transform: "scale(1.5)", opacity: 0 }],
        { duration: 650, easing: "ease-out" },
      ).onfinish = () => ring.remove();
    };
    document.body.append(cursor, caption);
    addEventListener("mousemove", (e) => { cursor.style.left = `${e.clientX - 3}px`; cursor.style.top = `${e.clientY - 2}px`; }, true);
    addEventListener("mousedown", (e) => { cursor.style.transform = "scale(.8)"; if (touch) tap(e.clientX, e.clientY); }, true);
    addEventListener("mouseup", () => { cursor.style.transform = ""; }, true);
  };
  if (document.body) add();
  else addEventListener("DOMContentLoaded", add);
}

const fingers = new WeakSet(); // the contexts that are a phone: taps, no cursor to glide
async function newContext({ login = true, touch = false, ...options } = {}) {
  const ctx = await browser.newContext({
    viewport: SIZE, recordVideo: { dir: `${OUT}/raw`, size: options.viewport || SIZE },
    ignoreHTTPSErrors: true, colorScheme: "dark", extraHTTPHeaders: { Origin: BASE }, ...options,
  });
  ctx.setDefaultTimeout(30000);
  await ctx.addInitScript(overlay, { touch });
  if (touch) fingers.add(ctx);
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
// The cursor moves as a hand moves it: slow off the mark, quick across, slow onto the
// target; on a slight arc; longer the further it goes; and landing near the middle of
// what it aims at, not on its exact centre. Playwright's own move is a straight line at one
// speed.
const at = new WeakMap(); // where each page's cursor is: Playwright doesn't say
const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const near = (size, most) => (Math.random() - 0.5) * Math.min(size * 0.3, most);
async function glide(p, locator) {
  await locator.waitFor({ state: "visible" });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const to = { x: box.x + box.width / 2 + near(box.width, 24), y: box.y + box.height / 2 + near(box.height, 6) };
  const view = p.viewportSize();
  const from = at.get(p) ?? { x: view.width * 0.6, y: view.height * 0.45 };
  const dx = to.x - from.x, dy = to.y - from.y, far = Math.hypot(dx, dy) || 1;
  const ms = Math.min(720, 180 + far * 0.65);
  // A finger lifts between taps: nothing to see until it lands.
  const frames = fingers.has(p.context()) ? 1 : Math.max(6, Math.round(ms / 16));
  // The arc: the path's midpoint pushed a fourteenth of its length to one side.
  const mid = { x: from.x + dx / 2 - (dy / far) * (far / 14), y: from.y + dy / 2 + (dx / far) * (far / 14) };
  for (let i = 1; i <= frames; i++) {
    const t = ease(i / frames), u = 1 - t;
    await p.mouse.move(u * u * from.x + 2 * u * t * mid.x + t * t * to.x, u * u * from.y + 2 * u * t * mid.y + t * t * to.y);
    await pause(p, ms / frames);
  }
  at.set(p, to);
  return { x: to.x - box.x, y: to.y - box.y }; // within the target, for a click where the cursor is
}
// Glide to the target, then click it — as a hand would.
async function click(p, locator) {
  const position = await glide(p, locator);
  await pause(p, 140);
  await locator.click({ position });
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
const point = (p, locator) => glide(p, locator);

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
    await pause(p, 350);
  }
  await pause(p, 300);
  await click(p, tab(p, "Routing"));
  await caption(p, "Routing — give a service a name of its own");
  await pause(p, 1100);
  await click(p, p.getByRole("button", { name: "Add route" }).first());
  await caption(p, "Add route → pick a container");
  await click(p, dialog(p).getByText("jellyfin-jellyfin-1"));
  await caption(p, "One step: Caddy's route and AdGuard's DNS name");
  await pause(p, 1500);
  await click(p, dialog(p).getByRole("button", { name: "Add route" }));
  await dialog(p).waitFor({ state: "detached" });
  await p.getByText("jellyfin.home.lan").first().waitFor();
  await caption(p, "https://jellyfin.home.lan — routed, and in DNS");
  await pause(p, 1800);
  await click(p, tab(p, "Dashboard"));
  const jellyfin = cards.filter({ hasText: "Jellyfin" });
  await point(p, jellyfin);
  await caption(p, "…and on the dashboard, for everyone at home");
  await pause(p, 2800);
});

// Docker: a stack opened to its containers, then an app installed from its recipe and named
// from the wizard's last step. (A container's log, opened here once, doubled the image: a
// screen of small text is the costliest thing an animation can show.)
await record("docker", async (p, start) => {
  await go(p, "/docker");
  start();
  await caption(p, "Docker — every stack and its containers");
  await pause(p, 1800);
  await click(p, p.getByRole("row").filter({ hasText: "jellyfin" }).first().getByRole("button", { name: "jellyfin", exact: true }));
  await caption(p, "Open a stack: its containers, a click from their logs and a terminal");
  await point(p, p.getByRole("row").filter({ hasText: "jellyfin-jellyfin-1" }).getByRole("button", { name: "Logs" }));
  await pause(p, 2000);
  await click(p, p.getByRole("button", { name: "Install recipe" }));
  await caption(p, "Install an app from a recipe");
  await pause(p, 1200);
  await click(p, dialog(p).getByRole("button", { name: /Forgejo/ }));
  await pause(p, 1300);
  await click(p, dialog(p).getByRole("button", { name: "Continue" }));
  await caption(p, "Its settings, with defaults");
  await pause(p, 1300);
  await click(p, dialog(p).getByRole("button", { name: "Deploy", exact: true }));
  await caption(p, "Installing…");
  await dialog(p).getByText("Route it").waitFor({ timeout: 180000 });
  await caption(p, "Installed — and named from the same dialog");
  await pause(p, 1200);
  await click(p, dialog(p).getByRole("button", { name: "Add route" }));
  await pause(p, 2300);
  await click(p, dialog(p).getByRole("button", { name: "Done", exact: true }).last());
  await caption(p, "Forgejo, running at https://git.home.lan");
  await pause(p, 3000);
});

// Machines: a machine's dialog over SSH — its overview, a service restarted in one click,
// and Claude Code started in a project. On the demo's machine `claude` is a stand-in
// (demo/machine/Dockerfile), so the flow stops at Loskai's card and never attaches.
await record("machines", async (p, start) => {
  const r = await p.context().request.post(`${BASE}/api/ssh/unlock`, { data: { password: process.env.LOSKAI_PASSWORD } });
  if (!r.ok()) throw new Error(`unlock: ${r.status()}`);
  const section = (name) => dialog(p).getByRole("button", { name, exact: true });
  await go(p, "/machines");
  start();
  await caption(p, "Machines — your computers by name, and what runs on them");
  await pause(p, 1500);
  await click(p, p.getByRole("row").filter({ hasText: "nas.home.lan" }).getByTitle(/^Machine settings/));
  await caption(p, "Over SSH: its overview — system, memory, disks, updates");
  await pause(p, 2200);
  await click(p, section("Running"));
  await caption(p, "What runs on it — every service");
  await pause(p, 1200);
  await click(p, dialog(p).getByRole("button", { name: "Restart", exact: true }).first());
  await caption(p, "One click: it runs on the machine, and says how it went");
  await p.getByText("Done", { exact: true }).first().waitFor();
  await pause(p, 1000);
  // The run's drop-down stays while the cursor is on it: off it, it slides away.
  await point(p, section("Tools"));
  await p.getByText("Restart nginx").first().waitFor({ state: "hidden" });
  await click(p, section("Tools"));
  await caption(p, "Its tools — Git and Claude Code, for each project");
  await pause(p, 1300);
  await click(p, dialog(p).getByRole("button", { name: "Start", exact: true }).last());
  await caption(p, "Claude Code, started in that project");
  await p.getByText(/Claude runs in homelab/).first().waitFor();
  await pause(p, 1800);
  await point(p, dialog(p).getByRole("button", { name: "Attach", exact: true }).last());
  await caption(p, "It runs in the background — Attach to watch it");
  await pause(p, 2600);
});

// A phone: the same pages, laid out for a small screen — a tour of the tabs from the menu,
// each tap a ring where the finger lands.
await record("phone", async (p, start) => {
  await go(p, "/");
  start();
  await caption(p, "Loskai on a phone");
  await pause(p, 2200);
  for (const [name, says] of [["Routing", "Routes, as cards"], ["Docker", "Stacks and containers"], ["Machines", "Machines, and what runs on them"]]) {
    await click(p, p.getByRole("button", { name: "Menu" }));
    await pause(p, 500);
    await click(p, tab(p, name));
    await caption(p, says);
    await pause(p, 2400);
  }
}, { ...devices["Pixel 7"], touch: true });

// Merged with an earlier run's, so ONLY rerecords some flows and keeps the others' marks.
const earlier = fs.existsSync(`${OUT}/marks.txt`) ? fs.readFileSync(`${OUT}/marks.txt`, "utf8").split("\n") : [];
const fresh = new Set(marks.map((m) => m.split(" ")[0]));
fs.writeFileSync(`${OUT}/marks.txt`, `${[...earlier.filter((m) => m && !fresh.has(m.split(" ")[0])), ...marks].join("\n")}\n`);

await browser.close();
