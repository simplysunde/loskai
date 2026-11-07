// check-phone.mjs — run by check-phone.sh, in Playwright's image. Opens each page and the
// main dialogs at each width, saves a screenshot of each, and reports text that overlaps
// other text, sticks out past the screen, is cut off without an ellipsis, or is squeezed
// into a sliver — a word a line, or an ellipsis left a few letters.
//
// It changes nothing but the sign-in log: it opens pages and dialogs and closes them with
// Escape — it never confirms, saves or deletes, and leaves out destructive dialogs' openers.
// Check for updates syncs the recipe sources as it opens; that sync is answered here. With BUSY
// (the default), a machine's overview and what runs on it, and Check for updates, are
// answered with crowded made-up data, so long names are tried whatever the homelab holds.
import fs from "node:fs";
import { chromium, devices } from "playwright";

const BASE = process.env.LOSKAI_URL.replace(/\/$/, "");
const WIDTHS = (process.env.WIDTHS || "412 360").split(/\s+/).filter(Boolean).map(Number);
// Tall, so a whole page is checked, not only its first screen.
const HEIGHT = Number(process.env.HEIGHT || 1800);
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const BUSY = process.env.BUSY !== "0";
const OUT = "/out";

// What the page shows, checked in the browser: every line of text (a text node's own line
// boxes, so a box too narrow for its text can't hide the spill) and every control and icon,
// each cut to what its clipping ancestors let through.
function audit() {
  const dialogs = [...document.querySelectorAll("[role=dialog],[role=menu]")];
  const root = dialogs.length ? dialogs[dialogs.length - 1] : document.querySelector("main") || document.body;
  const W = innerWidth, H = innerHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > H) return false;
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") return false;
    }
    return true;
  };
  const clipped = (el) => {
    const r = el.getBoundingClientRect();
    let [l, t, rt, b] = [r.left, r.top, r.right, r.bottom];
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (/(hidden|auto|scroll|clip)/.test(s.overflowX + s.overflowY)) {
        const q = e.getBoundingClientRect();
        [l, t, rt, b] = [Math.max(l, q.left), Math.max(t, q.top), Math.min(rt, q.right), Math.min(b, q.bottom)];
      }
    }
    return { l, t, r: rt, b };
  };
  const name = (el) =>
    (el.getAttribute?.("aria-label") || el.getAttribute?.("title") || el.placeholder || el.value || el.textContent || el.tagName)
      .trim().replace(/\s+/g, " ").slice(0, 40);

  const items = [];
  const squeezed = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const el = t.parentElement;
    if (!t.textContent.trim() || !el || !visible(el) || el.closest("option,script,style,.xterm")) continue;
    const range = document.createRange();
    range.selectNodeContents(t);
    const clip = clipped(el);
    const lines = [...range.getClientRects()];
    if (lines.length >= 3 && Math.max(...lines.map((r) => r.width)) < W / 4) squeezed.add(`squeezed "${name(el)}"`);
    for (const r of lines) {
      const c = { l: Math.max(r.left, clip.l), t: Math.max(r.top, clip.t), r: Math.min(r.right, clip.r), b: Math.min(r.bottom, clip.b) };
      if (c.r - c.l > 1 && c.b - c.t > 1) items.push({ el, c, text: true });
    }
  }
  for (const el of root.querySelectorAll("input,select,textarea,svg")) {
    if (!visible(el) || el.closest(".xterm")) continue;
    const c = clipped(el);
    if (c.r - c.l > 1 && c.b - c.t > 1) items.push({ el, c, text: false });
  }

  const overlaps = new Set();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], z = items[j];
      // Text over text or a control; a control on a control is a layout choice.
      if (a.el === z.el || (!a.text && !z.text) || a.el.contains(z.el) || z.el.contains(a.el)) continue;
      const w = Math.min(a.c.r, z.c.r) - Math.max(a.c.l, z.c.l);
      const h = Math.min(a.c.b, z.c.b) - Math.max(a.c.t, z.c.t);
      if (w > 2 && h > 3) overlaps.add(`overlap "${name(a.el)}" × "${name(z.el)}"`);
    }
  }
  const sticking = new Set(), cut = new Set();
  for (const { el } of items) {
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) {
      let scrolls = false;
      for (let e = el.parentElement; e && !scrolls; e = e.parentElement) {
        scrolls = /(auto|scroll)/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth;
      }
      if (!scrolls) sticking.add(`off the screen "${name(el)}"`);
    }
    const s = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== "ellipsis"
        && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) cut.add(`cut "${name(el)}"`);
    if (s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 2 && el.clientWidth < 48) squeezed.add(`squeezed "${name(el)}"`);
  }
  return [...overlaps, ...sticking, ...cut, ...squeezed];
}

// The made-up data BUSY answers with: long names, many rows, every kind of thing.
const DAY = 86400;
const FACTS = {
  ok: true, checked: Date.now() / 1000, os: "Debian GNU/Linux 12 (bookworm)", os_id: "debian", os_like: [],
  kernel: "Linux 6.1.0-28-amd64", uptime: 3 * DAY + 7200,
  memory: { total: 8 * 1024 ** 3, available: 2 * 1024 ** 3 },
  disks: [
    { mount: "/", device: "/dev/sda1", size: 100 * 1024 ** 3, used: 95 * 1024 ** 3 },
    { mount: "/mnt/storage-pool-with-a-long-name", device: "/dev/mapper/vg0-storage", size: 4000 * 1024 ** 3, used: 1200 * 1024 ** 3 },
  ],
  updates: { manager: "apt", count: 12 }, programs: ["docker", "tmux", "tailscale", "git", "claude"], tailscale: "100.64.0.7",
  tailnet: [
    { ip: "100.64.0.7", name: "this-machine", os: "linux", online: true, self: true, status: "-" },
    { ip: "100.64.0.9", name: "phone-of-someone-long", os: "iOS", online: false, self: false, status: "offline, last seen 3d ago" },
  ],
  tmux: [
    { name: "build", created: 1793212547, attached: false, windows: 2 },
    { name: "a-rather-long-session-name", created: 1793212547, attached: true, windows: 5 },
  ],
  projects: [
    { path: "projects/site", folder: "projects", name: "site", branch: "main", dirty: true, claude: 1793212000, ahead: 2,
      committed: 1793211000, subject: "Add the header and a much longer commit subject that runs on" },
    { path: "projects/a-project-with-a-long-name", folder: "projects", name: "a-project-with-a-long-name",
      branch: "feature/a-long-branch-name", dirty: false, claude: 0, committed: 1793011000, subject: "x" },
  ],
};
const RUNNING = {
  ok: true, checked: Date.now() / 1000, hidden: 14, denied: [],
  containers: [
    { name: "jellyfin", image: "jellyfin/jellyfin:12.2", status: "Up 2 days (healthy)" },
    { name: "a-container-with-a-really-long-name-1", image: "ghcr.io/someone/some-image-name:2026.11.1", status: "Up 5 hours" },
  ],
  services: ["nginx", "postgresql@15-main", "smbd"],
  guests: [
    { id: "101", name: "adguard", kind: "lxc", status: "running" },
    { id: "102", name: "home-assistant-vm", kind: "vm", status: "stopped" },
  ],
};
const UPDATES = [
  { stack: "a-stack-with-a-long-name", recipe: "jellyfin", name: "Jellyfin media server", icon: false, source: "loskai-recipes",
    status: "available", updatable: true, reason: null,
    images: [{ service: "jellyfin", from: "jellyfin/jellyfin:12.1", to: "jellyfin/jellyfin:12.2" }],
    diff: "--- installed\n+++ recipe\n-    image: jellyfin/jellyfin:12.1\n+    image: jellyfin/jellyfin:12.2\n",
    commits: [{ commit: "4d27a85", date: "2026-10-16", subject: "Jellyfin 12.2", body: "Fixes two migrations." }], new_env: ["TZ"] },
  { stack: "whoami", recipe: "whoami", name: "Whoami", icon: false, source: "loskai-recipes", status: "current",
    updatable: false, reason: null, images: [], diff: "", commits: [], new_env: [] },
];

async function busy(ctx) {
  const get = (route, json) => (route.request().method() === "GET" ? route.fulfill({ json }) : route.continue());
  await ctx.route("**/api/ssh/machines/*/facts", (r) => get(r, FACTS));
  await ctx.route("**/api/ssh/running", async (r) => {
    if (r.request().method() !== "GET") return r.continue();
    const real = await (await r.fetch()).json();
    await r.fulfill({ json: Object.fromEntries(Object.keys(real).map((id) => [id, RUNNING])) });
  });
  await ctx.route("**/api/docker/recipes/updates", (r) => get(r, UPDATES));
}

const go = async (p, path) => {
  await p.goto(BASE + path);
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.waitForTimeout(800);
};
const button = (p, name) => p.getByRole("button", { name, exact: typeof name === "string" }).first().click();
const titled = (p, title) => p.getByTitle(title).first().click();
const dialog = (p) => p.getByRole("dialog").last();
// Each Expand all on the page — clicked, it turns into Collapse all, so take the first left.
async function expandAll(p) {
  const left = p.getByRole("button", { name: /^Expand all/ });
  for (let n = await left.count(); n > 0; n--) await left.first().click();
}

// Each step: a name, the page it starts on, and what it opens there. `phone`: only where
// the sidebar is a drawer (below 768px).
const PAGES = ["/", "/certificate", "/docker", "/routing", "/machines", "/settings", "/settings/network",
  "/settings/ssh", "/settings/users", "/settings/security", "/settings/logs"];
const STEPS = [
  ...PAGES.map((path) => ({ name: "page" + (path === "/" ? "-dashboard" : path.replace(/\//g, "-")), path })),
  { name: "docker-expanded", path: "/docker", open: expandAll },
  { name: "docker-volumes", path: "/docker", open: (p) => p.getByRole("tab", { name: "Volumes" }).click() },
  { name: "docker-updates", path: "/docker", open: (p) => button(p, "Check for updates") },
  { name: "docker-new-stack", path: "/docker", open: (p) => button(p, "New stack") },
  { name: "docker-install-recipe", path: "/docker", open: (p) => button(p, "Install recipe") },
  { name: "docker-edit-stack", path: "/docker", open: (p) => titled(p, "Edit") },
  { name: "routing-add-container", path: "/routing", open: (p) => button(p, "Add route") },
  { name: "routing-add-network", path: "/routing", open: async (p) => { await button(p, "Add route"); await dialog(p).getByRole("button", { name: "Network" }).click(); } },
  { name: "routing-add-external", path: "/routing", open: async (p) => { await button(p, "Add route"); await dialog(p).getByRole("button", { name: "External" }).click(); } },
  { name: "routing-change-url", path: "/routing", open: (p) => titled(p, "Change URL") },
  { name: "machines-expanded", path: "/machines", open: expandAll },
  { name: "machines-name", path: "/machines", open: (p) => button(p, "Name a machine") },
  { name: "machines-add-route", path: "/machines", open: (p) => titled(p, "Add a route on this machine") },
  { name: "settings-add-user", path: "/settings/users", open: (p) => button(p, "Add user") },
  { name: "drawer", path: "/docker", phone: true, open: (p) => button(p, "Menu") },
  { name: "account-menu", path: "/docker", phone: true, open: async (p) => { await button(p, "Menu"); await titled(p, "Your account"); } },
  { name: "change-password", path: "/docker", phone: true, open: async (p) => {
    await button(p, "Menu"); await titled(p, "Your account"); await p.getByRole("menuitem", { name: "Change password" }).click();
  } },
];

const browser = await chromium.launch();
const findings = [];
const missed = [];

for (const width of WIDTHS) {
  const ctx = await browser.newContext({
    ...devices["Pixel 7"], viewport: { width, height: HEIGHT }, isMobile: width < 768, hasTouch: width < 768,
  });
  ctx.setDefaultTimeout(5000);
  await ctx.route("**/api/docker/recipes/refresh", (r) => r.fulfill({ json: { ok: true, output: "" } }));
  if (BUSY) await busy(ctx);
  const p = await ctx.newPage();
  const shots = [];
  let n = 0;

  async function shot(name) {
    n += 1;
    const file = `${width}-${String(n).padStart(2, "0")}-${name}.png`;
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/${file}` });
    const found = await p.evaluate(audit);
    shots.push({ file, name, found: found.length });
    console.log(`${found.length ? "✗" : "✓"} ${width} ${name}`);
    for (const f of found.slice(0, 10)) console.log(`    ${f}`);
    if (found.length) findings.push(`${width} ${name}`);
  }
  const why = (e) => (process.env.DEBUG ? e.message : String(e.message).split("\n")[0]);
  // Not opening is listed; opened but not checked is a finding.
  async function step(name, fn) {
    if (ONLY && !ONLY.test(name)) return;
    let opened = false;
    try {
      await fn();
      opened = true;
      await shot(name);
    } catch (e) {
      if (opened) {
        console.log(`✗ ${width} ${name}: couldn't check it (${why(e)})`);
        findings.push(`${width} ${name}`);
      } else {
        console.log(`- ${width} ${name}: couldn't open it (${why(e)})`);
        missed.push(`${width} ${name}`);
      }
    }
    for (let i = 0; i < 3; i++) await p.keyboard.press("Escape").catch(() => {});
  }

  await step("login", () => go(p, "/login"));
  await go(p, "/login");
  await p.getByLabel("Username").fill(process.env.LOSKAI_USER);
  await p.getByLabel("Password", { exact: true }).fill(process.env.LOSKAI_PASSWORD);
  await p.keyboard.press("Enter");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }).catch(() => {
    throw new Error(`Couldn't log in to ${BASE} as ${process.env.LOSKAI_USER}`);
  });

  for (const s of STEPS) {
    if (s.phone && width >= 768) continue;
    await step(s.name, async () => {
      await go(p, s.path);
      await s.open?.(p);
    });
  }

  // A machine's dialog, at each of its sections — the first machine that has them all (its
  // SSH set up), else the first there is.
  {
    await go(p, "/machines");
    const cogs = await p.getByTitle(/^Machine settings/).count();
    let pick = 0;
    for (let i = 0; i < cogs; i++) {
      await go(p, "/machines");
      await p.getByTitle(/^Machine settings/).nth(i).click();
      await p.waitForTimeout(1200);
      if (await dialog(p).getByRole("button", { name: "Running", exact: true }).count()) { pick = i; break; }
    }
    // None had it: the sections are the first machine's, as the steps open that one.
    if (cogs && !pick && !(await dialog(p).getByRole("button", { name: "Running", exact: true }).count())) {
      await go(p, "/machines");
      await p.getByTitle(/^Machine settings/).first().click();
      await p.waitForTimeout(1200);
    }
    const sections = cogs ? await dialog(p).getByRole("navigation", { name: "Categories" }).getByRole("button").allTextContents() : [];
    for (const section of sections) {
      await step(`machine-${section.trim().toLowerCase()}`, async () => {
        await go(p, "/machines");
        await p.getByTitle(/^Machine settings/).nth(pick).click();
        await p.waitForTimeout(1500);
        await dialog(p).getByRole("navigation", { name: "Categories" }).getByRole("button", { name: section.trim(), exact: true }).click();
      });
    }
  }
  await ctx.close();

  // Contact sheets, a dozen shots each, to look over by eye — the detector can't see a
  // table too wide for its box, which scrolls rather than spills.
  const per = 12;
  for (let i = 0; i * per < shots.length; i++) {
    const part = shots.slice(i * per, (i + 1) * per);
    const sheet = await browser.newPage({ viewport: { width: 4 * 310 + 16, height: 800 } });
    await sheet.setContent(`<body style="margin:0;padding:8px;display:grid;grid-template-columns:repeat(4,300px);gap:10px;background:#fff;font:600 13px sans-serif">${
      part.map((s) => `<div><div style="height:20px;color:${s.found ? "#c00" : "#000"}">${s.name}${s.found ? ` — ${s.found} found` : ""}</div><img src="data:image/png;base64,${
        fs.readFileSync(`${OUT}/${s.file}`).toString("base64")}" style="width:300px;border:1px solid #ccc"></div>`).join("")
    }</body>`);
    await sheet.screenshot({ path: `${OUT}/sheet-${width}-${i + 1}.png`, fullPage: true });
    await sheet.close();
  }
}
await browser.close();

console.log(`\n${findings.length ? `${findings.length} with something to look at: ${findings.join(", ")}` : "Nothing overlapping, off the screen, cut or squeezed."}`);
if (missed.length) console.log(`Not opened (nothing of that kind here, or the page changed): ${missed.join(", ")}`);
process.exit(findings.length ? 1 : 0);
