// setup.mjs — run by scripts/record-demo.sh, in Playwright's image, before record.mjs. Sets
// the made-up homelab up the way a user would, through Loskai's own API: the apps
// installed from their recipes, the NAS named and its SSH set up, a name for Home
// Assistant, and routes for all of it — except Jellyfin, which the Routing recording routes.
import { request } from "playwright";

const BASE = process.env.LOSKAI_URL;
const SUB = process.env.SUB;
const APPS = process.env.APPS.split(/\s+/).filter(Boolean);
const PASSWORD = process.env.LOSKAI_PASSWORD;
// Routed on camera, so left unrouted here.
const ON_CAMERA = "jellyfin";

const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });

async function call(method, path, data) {
  const r = await api.fetch(path, { method, data });
  const body = await r.text();
  if (!r.ok()) throw new Error(`${method} ${path} → ${r.status()}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}
const post = (path, data) => call("POST", path, data ?? {});
const secret = () => Array.from({ length: 20 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 31)]).join("");

await post("/api/login", { username: "admin", password: PASSWORD });
console.log("✓ logged in");

// With a folder of recipes (DEMO_RECIPES), the git sources are switched off, so the wizard
// lists only those and no sync is tried.
if (process.env.LOCAL_RECIPES) await call("PUT", "/api/settings", { recipes_repos: [] });
else await post("/api/docker/recipes/refresh");
const { recipes } = await call("GET", "/api/docker/recipes");
const byId = Object.fromEntries(recipes.map((r) => [r.id, r]));

for (const id of APPS) {
  const recipe = byId[id];
  if (!recipe) throw new Error(`no recipe '${id}' — the source has ${Object.keys(byId).join(", ")}`);
  // A secret has no default; anything else asked keeps its own.
  const answers = Object.fromEntries((recipe.env || []).filter((e) => e.secret).map((e) => [e.key, secret()]));
  const done = await post(`/api/docker/recipes/${id}/install`, { answers, mounts: [], options: [] });
  if (!done.container) throw new Error(`${id} installed, but no container was found: ${done.warning || ""}`);
  console.log(`✓ installed ${id} (${done.container})`);
  if (id === ON_CAMERA) continue;
  await post("/api/routes", {
    prefix: recipe.suggested_subdomain || id, container: done.container, follow_container: true, upstream: "",
  });
  console.log(`✓ routed ${id}`);
}

await post("/api/routes", { prefix: "adguard", origin: "adguard", name: "AdGuard Home", upstream: `${SUB}.2:3000` });
await post("/api/machines", { hostname: "homeassistant", address: `${SUB}.30` });
await post("/api/routes", { prefix: "ha", name: "Home Assistant", upstream: `${SUB}.30:8123` });
console.log("✓ AdGuard routed; Home Assistant named and routed");

await post("/api/ssh/key", { password: PASSWORD });
const nas = await post("/api/machines", { hostname: "nas", address: `${SUB}.50`, ssh: { user: "homelab", port: 22 } });
const { fingerprint } = await post(`/api/ssh/machines/${nas.instance_id}/scan`);
await post(`/api/ssh/machines/${nas.instance_id}/trust`, { fingerprint });
await post(`/api/ssh/machines/${nas.instance_id}/install`, { password: process.env.MACHINE_PASSWORD });
console.log("✓ nas named, its SSH set up");

await api.dispose();
