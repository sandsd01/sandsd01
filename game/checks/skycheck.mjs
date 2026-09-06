import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

// The tree, the island, and standing on things.
//
// The one genuinely new mechanic in here is falling: a floor that drops away
// under you has to make you fall rather than teleport you down. It is the same
// rule at the rim of the island and at the side of a rampart, so both are
// tested, and both are tested through real key input — `probeMoveTo` teleports,
// so a check driven by it would pass whether or not gravity was involved.
const URL = BASE_URL;

const browser = await chromium.launch({
  ...LAUNCH,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const D = (fn, ...a) => page.evaluate(fn, ...a);
const boot = async () => {
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
};
await page.goto(URL, { waitUntil: "load" });
await boot();
await D(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await boot();

const region = () => D(() => window.__gameDebug.getRegion());
const pos = () => D(() => window.__gameDebug.getPlayerPosition());

const walkInto = async (x, z, from = 14) => {
  const len = Math.hypot(x, z) || 1;
  await D(([px, pz]) => window.__gameDebug.teleportPlayer(px, pz), [
    x - (x / len) * from,
    z - (z / len) * from,
  ]);
  await page.waitForTimeout(400);
  await D(([tx, tz]) => window.__gameDebug.probeMoveTo(tx, tz, 220), [x, z]);
  await page.waitForTimeout(500);
};

// --- 1. the tree stands on the overworld, and it is one of a kind ----------
const sites = await D(() => window.__gameDebug.getPortalSites());
const skySites = sites.filter((s) => s.target === "sky");
ok("exactly one way up", skySites.length === 1, `${skySites.length} sky portals of ${sites.length}`);
const tree = skySites[0];
const treeDistance = Math.hypot(tree.x, tree.z);
ok(
  "and it is far enough to be a journey, near enough to be on the skyline",
  treeDistance > 80 && treeDistance < 140,
  `${treeDistance.toFixed(0)} units from spawn`,
);

// --- 2. walking into it puts you on the island, on its ground --------------
await walkInto(tree.x, tree.z);
let r = await region();
ok("walking into the portal reaches the island", r.id === "sky", `region=${r.id}`);
let p = await pos();
let ground = await D(([x, z]) => window.__gameDebug.terrainHeightAt(x, z), [p.x, p.z]);
ok(
  "and the player is standing on it, not over or under it",
  r.id === "sky" && Math.abs(p.y - ground) < 0.35,
  `y=${p.y.toFixed(2)} ground=${ground.toFixed(2)}`,
);

// --- 3. it is its own place -----------------------------------------------
const skyNodes = await D(() => window.__gameDebug.getResourceNodes());
const kinds = [...new Set(skyNodes.map((n) => n.kind))].sort();
ok(
  "the island's nodes are the island's",
  kinds.includes("cloud_iron") && !kinds.includes("tree") && !kinds.includes("glow_crystal"),
  `kinds=${kinds.join(",")}`,
);

// --- 4. the island has an edge, and walking off it is a fall ---------------
// Real keys, not `probeMoveTo`: that teleports, so a check driven by it would
// report a fall whether or not gravity was ever involved.
//
// Started close to the rim and given a long budget on purpose. Software
// rendering runs this at under two frames a second, and the first version of
// this check walked for two seconds from the middle of the island — about two
// units — and never reached the edge at all. It passed anyway, because rolling
// ground going downhill also produces "descending frames".
await D(() => window.__gameDebug.teleportPlayer(0, 20));
await D(() => window.__gameDebug.setCameraYaw(Math.PI));
await page.waitForTimeout(700);
const startY = (await pos()).y;
await page.keyboard.down("KeyW");
const trace = [];
for (let i = 0; i < 140; i++) {
  await page.waitForTimeout(160);
  trace.push((await pos()).y);
  if ((await region()).id !== "sky") break;
}
await page.keyboard.up("KeyW");

// The signature of a fall is a long unbroken descent, not a single step down.
let longest = 0;
let run = 0;
for (let i = 1; i < trace.length; i++) {
  if (trace[i] < trace[i - 1] - 0.02) run += trace[i - 1] - trace[i];
  else run = 0;
  longest = Math.max(longest, run);
}
ok(
  "walking off the rim is a fall, not a drop to the floor",
  longest > 5,
  `longest unbroken descent ${longest.toFixed(1)} units, from y=${startY.toFixed(2)}`,
);

for (let i = 0; i < 60 && (await region()).id === "sky"; i++) await page.waitForTimeout(250);
r = await region();
const health = await D(() => window.__gameDebug.getHealth());
ok("falling puts you back on the surface", r.id === "surface", `region=${r.id}`);
ok(
  "and costs health rather than the trip",
  health.current < health.max && health.current > 0,
  `${health.current}/${health.max}`,
);
p = await pos();
ok(
  "at the foot of the tree you climbed",
  Math.hypot(p.x - tree.returnX, p.z - tree.returnZ) < 1.5,
  `${Math.hypot(p.x - tree.returnX, p.z - tree.returnZ).toFixed(2)} from the tree`,
);

// --- 5. nothing follows you down ------------------------------------------
const followed = await D(() => window.__gameDebug.getEnemyPositions());
ok("nothing came down with you", followed.length === 0, `${followed.length} on the surface`);

// --- 6. the surface came back ---------------------------------------------
const surfaceNodes = await D(() => window.__gameDebug.getResourceNodes());
ok(
  "the overworld is back, whole",
  surfaceNodes.length > 1000 && surfaceNodes.some((n) => n.kind === "tree"),
  `${surfaceNodes.length} nodes`,
);

// --- 7. the rampart is something you walk up ------------------------------
await D(() => window.__gameDebug.placeBuildingAt("rampart", 2, 0, 0));
await page.waitForTimeout(600);
const groundAtTop = await D(() => window.__gameDebug.terrainHeightAt(7, 0.5));
await D(() => window.__gameDebug.teleportPlayer(0.5, 0.5));
await page.waitForTimeout(300);
await D(() => window.__gameDebug.probeMoveTo(7, 0.5, 200));
await page.waitForTimeout(400);
const onTop = await pos();
ok(
  "you can walk up a rampart",
  onTop.y - groundAtTop > 2,
  `stood ${(onTop.y - groundAtTop).toFixed(2)} above the ground`,
);

// --- 8. and cannot be lifted up its side ----------------------------------
await D(() => window.__gameDebug.teleportPlayer(11, 0.5));
await page.waitForTimeout(300);
const fromTall = await D(() => window.__gameDebug.probeMoveTo(3, 0.5, 200));
const afterTall = await pos();
ok(
  "walking into the tall end is blocked, not a lift up the side",
  fromTall.x > 7.5 && afterTall.y < 0.5 + groundAtTop,
  `stopped at x=${fromTall.x.toFixed(2)}, y=${afterTall.y.toFixed(2)}`,
);

// --- 9. standing on it puts you out of reach ------------------------------
await D(() => window.__gameDebug.teleportPlayer(6.5, 0.5));
await page.waitForTimeout(400);
await D(() => window.__gameDebug.spawnEnemyAt("zombie", 6.5, 1.7));
await page.waitForTimeout(400);
const before = (await D(() => window.__gameDebug.getHealth())).current;
await D(() => window.__gameDebug.advanceClockMs(8000));
await page.waitForTimeout(2500);
const after = (await D(() => window.__gameDebug.getHealth())).current;
ok(
  "a raider at the foot cannot reach you on top",
  after === before,
  `${before} -> ${after}, still at y=${(await pos()).y.toFixed(2)}`,
);

// --- 10. but the same raider can reach you on the ground -------------------
// The other half of the same claim: without it, check 9 passes on a build
// where the enemy simply never attacks.
await D(() => window.__gameDebug.teleportPlayer(6.5, 4));
await page.waitForTimeout(400);
await D(() => window.__gameDebug.spawnEnemyAt("zombie", 6.9, 4));
const groundBefore = (await D(() => window.__gameDebug.getHealth())).current;
await D(() => window.__gameDebug.advanceClockMs(8000));
await page.waitForTimeout(2500);
const groundAfter = (await D(() => window.__gameDebug.getHealth())).current;
ok(
  "the same raider on level ground does reach you",
  groundAfter < groundBefore,
  `${groundBefore} -> ${groundAfter}`,
);

// --- 11. no building or farming up there ----------------------------------
await walkInto(tree.x, tree.z);
ok("back on the island", (await region()).id === "sky");
const built = await D(() => window.__gameDebug.placeBuildingAt("wall", 3, 3, 0));
ok("building on the island is refused", built === null, `returned ${built}`);

// --- 12. the raid clock is held up here too -------------------------------
const raidBefore = await D(() => window.__gameDebug.getRaidState());
await D(() => window.__gameDebug.advanceClockMs(120000));
await page.waitForTimeout(1200);
const raidAfter = await D(() => window.__gameDebug.getRaidState());
ok(
  "two minutes on the island do not bring the raid two minutes closer",
  Math.abs(raidAfter.msUntilRaid - raidBefore.msUntilRaid) < 20000 && !raidAfter.active,
  `${Math.round(raidBefore.msUntilRaid / 1000)}s -> ${Math.round(raidAfter.msUntilRaid / 1000)}s`,
);

// --- 13. quitting up there puts you back at the tree -----------------------
await D(() => window.__gameDebug.saveNow());
await page.reload({ waitUntil: "load" });
await boot();
r = await region();
p = await pos();
ok(
  "a save taken on the island loads at the tree, not in mid-air",
  r.id === "surface" && Math.hypot(p.x - tree.returnX, p.z - tree.returnZ) < 1.5,
  `region=${r.id}, ${Math.hypot(p.x - tree.returnX, p.z - tree.returnZ).toFixed(2)} from the tree`,
);

// --- 14. the island resets on every entry ---------------------------------
await walkInto(tree.x, tree.z);
const firstVisit = await D(() => window.__gameDebug.getResourceNodes());
const exit = (await region()).portals[0];
await walkInto(exit.x, exit.z, 10);
ok("out again", (await region()).id === "surface");
await walkInto(tree.x, tree.z);
const secondVisit = await D(() => window.__gameDebug.getResourceNodes());
const shared = secondVisit.filter((n) => firstVisit.some((f) => f.id === n.id)).length;
ok(
  "the next trip up is a fresh island",
  (await region()).id === "sky" && shared === 0 && secondVisit.length > 10,
  `${shared} node ids shared, ${secondVisit.length} nodes`,
);

ok("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

const fails = results.filter((r) => !r.pass).length;
console.log(`RESULT skycheck ${results.length - fails}/${results.length} fails=${fails}`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
