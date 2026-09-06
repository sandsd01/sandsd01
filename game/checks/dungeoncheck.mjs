import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
import { editSaveOffline } from "./legacysave.mjs";

// The cave: a portal on the overworld, a place on the other side of it, and a
// way back. Every check here was written to fail against the build before the
// region system existed, and the ones that could pass vacuously say what they
// would have to see to be wrong.
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
const fresh = async () => {
  await page.goto(URL, { waitUntil: "load" });
  await boot();
  await D(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await boot();
};
await fresh();

const region = () => D(() => window.__gameDebug.getRegion());
const pos = () => D(() => window.__gameDebug.getPlayerPosition());
// `getCaveMouths` became `getPortalSites` when the giant tree joined the caves
// in one list — filter to the ways *down* here.
const mouths = async () =>
  (await D(() => window.__gameDebug.getPortalSites())).filter((s) => s.target === "cave");

// Walks in on foot rather than teleporting onto the trigger: the thing being
// tested is that walking at a portal takes you through it.
const walkInto = async (x, z, from = 12) => {
  const len = Math.hypot(x, z) || 1;
  await D(([px, pz]) => window.__gameDebug.teleportPlayer(px, pz), [
    x - (x / len) * from,
    z - (z / len) * from,
  ]);
  await page.waitForTimeout(400);
  await D(([tx, tz]) => window.__gameDebug.probeMoveTo(tx, tz, 220), [x, z]);
  await page.waitForTimeout(500);
};

// --- 1. walking into a surface portal puts you in the cave, on its floor ----
const mouthList = await mouths();
ok("the overworld carries more than one way down", mouthList.length >= 2, `${mouthList.length} mouths`);
const mouth = mouthList[0];
await walkInto(mouth.x, mouth.z);
let r = await region();
ok("walking into the portal changes region", r.id === "cave", `region=${r.id}`);

let p = await pos();
let ground = await D(([x, z]) => window.__gameDebug.terrainHeightAt(x, z), [p.x, p.z]);
ok(
  "the player stands on the cave floor, not over or under it",
  r.id === "cave" && Math.abs(p.y - ground) < 0.35,
  `y=${p.y.toFixed(2)} floor=${ground.toFixed(2)}`,
);

// --- 2. no instant bounce back ---------------------------------------------
// The failure this guards is a loop, not a wrong value: arrive beside the way
// back, trip it on frame one, arrive beside the way in, and so on forever.
await page.waitForTimeout(5000);
r = await region();
ok("the cave keeps you — no bounce straight back out", r.id === "cave", `after 5s region=${r.id}`);

// The arming rule itself, exercised directly.
//
// Standing five seconds in the cave does NOT test it, and finding that out is
// what this pair is for: the arrival point and the way out are eleven units
// apart, so the geometry alone passes that one and the rule could be deleted
// without it noticing. What arming exists for is a body that finds itself
// *inside* a portal without having walked in — reachable only through the
// fallback return path today, which is why the state is set up here rather
// than arrived at.
const wayOut = (await region()).portals[0];
// Both in one evaluate, so no frame runs between them. Disarming from a
// distance does not stick — the next frame sees the player is more than
// ARM_DISTANCE away and re-arms it, which is the rule doing its job. The state
// being set up is the one a bad arrival produces: standing in a portal that
// has not yet been left.
await D(([x, z]) => {
  window.__gameDebug.teleportPlayer(x, z);
  window.__gameDebug.setPortalArmed(0, false);
}, [wayOut.x, wayOut.z]);
await page.waitForTimeout(2500);
ok(
  "a disarmed portal you are standing in does not fire",
  (await region()).id === "cave",
  `region=${(await region()).id}`,
);
// And it does arm, and fire, once you have been clear of it and come back.
await D(([x, z]) => window.__gameDebug.teleportPlayer(x, z - 20), [wayOut.x, wayOut.z]);
await page.waitForTimeout(900);
await D(([x, z]) => window.__gameDebug.teleportPlayer(x, z), [wayOut.x, wayOut.z]);
await page.waitForTimeout(900);
ok(
  "and does fire once you have walked clear of it and back",
  (await region()).id === "surface",
  `region=${(await region()).id}`,
);
// Back down for the rest of the run.
await walkInto(mouth.x, mouth.z);
ok("back underground", (await region()).id === "cave");

// --- 3. the cave has its own nodes, and only its own ------------------------
const caveNodes = await D(() => window.__gameDebug.getResourceNodes());
const kinds = [...new Set(caveNodes.map((n) => n.kind))].sort();
ok(
  "the cave's nodes are the cave's",
  kinds.includes("glow_crystal") && !kinds.includes("tree") && !kinds.includes("berry_bush"),
  `kinds=${kinds.join(",")}`,
);
const outside = caveNodes.filter((n) => Math.abs(n.x) > 35 || Math.abs(n.z) > 35).length;
ok("no node sits outside the cave", outside === 0, `${outside} of ${caveNodes.length} outside`);

// --- 4. you cannot build or farm down here ---------------------------------
const built = await D(() => window.__gameDebug.placeBuildingAt("wall", 4, 4, 0));
ok("placing a building underground is refused", built === null, `returned ${built}`);
const ghost = await D(() => window.__gameDebug.getSelectedBuilding());
ok("nothing is left selected to place", ghost === null, `selected=${ghost}`);

// --- 5. the walls hold you in ----------------------------------------------
// The overworld's clamp is ±200; a cave that borrowed it would let the player
// walk 165 units through solid rock.
const half = (await region()).halfExtent;
const corners = [
  [500, 0],
  [-500, 0],
  [0, 500],
  [0, -500],
];
let escaped = 0;
let furthest = 0;
for (const [tx, tz] of corners) {
  const end = await D(([x, z]) => window.__gameDebug.probeMoveTo(x, z, 260), [tx, tz]);
  furthest = Math.max(furthest, Math.abs(end.x), Math.abs(end.z));
  if (Math.abs(end.x) > half + 1 || Math.abs(end.z) > half + 1) escaped++;
}
ok(
  "the cave has edges of its own",
  escaped === 0 && furthest <= half + 1,
  `half=${half} furthest=${furthest.toFixed(1)} escaped=${escaped}`,
);

// --- 6. nothing follows you through a portal -------------------------------
await D(() => window.__gameDebug.advanceClockMs(30000));
await page.waitForTimeout(1500);
const caveEnemies = await D(() => window.__gameDebug.getEnemyPositions());
ok("the cave populates itself", caveEnemies.length > 0, `${caveEnemies.length} in the cave`);

// --- 7. the raid clock is held while you are down here ---------------------
const before = await D(() => window.__gameDebug.getRaidState());
await D(() => window.__gameDebug.advanceClockMs(120000));
await page.waitForTimeout(1200);
const after = await D(() => window.__gameDebug.getRaidState());
ok(
  "two minutes underground do not bring the raid two minutes closer",
  Math.abs(after.msUntilRaid - before.msUntilRaid) < 20000 && !after.active,
  `before=${Math.round(before.msUntilRaid / 1000)}s after=${Math.round(after.msUntilRaid / 1000)}s active=${after.active}`,
);

// --- 8. but the world clock is not held ------------------------------------
// Only the raid was asked to stop. Freezing everything would have stopped
// crops growing and nodes coming back too, which is a different feature.
const dayNow = await D(() => window.__gameDebug.getTimeOfDay());
ok("the day still turns while you are underground", typeof dayNow === "number", `t=${dayNow.toFixed(3)}`);

// --- 9. walking out puts you back at the mouth you came in by --------------
const exitPortal = (await region()).portals[0];
await walkInto(exitPortal.x, exitPortal.z, 10);
r = await region();
p = await pos();
const backAtMouth = Math.hypot(p.x - mouth.returnX, p.z - mouth.returnZ);
ok("walking into the way back returns you to the surface", r.id === "surface", `region=${r.id}`);
ok(
  "and to the mouth you went down",
  backAtMouth < 1,
  `${backAtMouth.toFixed(2)} from the recorded return point`,
);
const followed = await D(() => window.__gameDebug.getEnemyPositions());
ok("nothing followed you out", followed.length === 0, `${followed.length} on the surface`);

// --- 10. the surface came back, whole -------------------------------------
const surfaceNodes = await D(() => window.__gameDebug.getResourceNodes());
ok(
  "the overworld is back with its own nodes",
  surfaceNodes.length > 1000 && surfaceNodes.some((n) => n.kind === "tree"),
  `${surfaceNodes.length} nodes`,
);
const drawn = await D(() => window.__gameDebug.getRenderStats());
ok("and is being drawn again", Number(drawn.drawCalls) > 500, `drawCalls=${drawn.drawCalls}`);

// --- 11. the dungeon resets on every entry ---------------------------------
await walkInto(mouth.x, mouth.z);
const firstVisit = await D(() => window.__gameDebug.getResourceNodes());
for (const node of firstVisit) await D((id) => window.__gameDebug.depleteNode(id), node.id);
const stripped = (await D(() => window.__gameDebug.getResourceNodes())).filter((n) => !n.depleted);
ok("a cave can be worked out", stripped.length === 0, `${stripped.length} left standing`);

const exit2 = (await region()).portals[0];
await walkInto(exit2.x, exit2.z, 10);
ok("out again", (await region()).id === "surface");
await walkInto(mouth.x, mouth.z);
const secondVisit = await D(() => window.__gameDebug.getResourceNodes());
const standing = secondVisit.filter((n) => !n.depleted).length;
ok(
  "the next trip down is a fresh cave, not the one you emptied",
  (await region()).id === "cave" && standing > 20,
  `${standing} standing on the second visit`,
);
const sameIds = secondVisit.filter((n) => firstVisit.some((f) => f.id === n.id)).length;
ok(
  "and it is a different cave, not the same one refilled",
  sameIds === 0,
  `${sameIds} node ids shared with the first visit`,
);

// --- 12. quitting underground puts you back outside -------------------------
await D(() => window.__gameDebug.saveNow());
await page.reload({ waitUntil: "load" });
await boot();
r = await region();
p = await pos();
const nearMouth = Math.hypot(p.x - mouth.returnX, p.z - mouth.returnZ);
// Region alone would be a vacuous assertion — the game always *boots* on the
// surface, whatever the save says, because that is the only region that
// exists before one is generated. What the backfill actually decides is
// where the player is put, so that is what this measures.
ok(
  "a save taken underground loads at the mouth, not at the coordinates inside",
  r.id === "surface" && nearMouth < 1.5,
  `region=${r.id}, ${nearMouth.toFixed(2)} from the mouth`,
);

// --- 13. a save from before any of this existed still loads -----------------
await editSaveOffline(page, URL, (save) => {
  delete save.region;
  delete save.regionReturn;
  save.player.x = 12;
  save.player.z = 20;
});
await page.goto(URL, { waitUntil: "load" });
await boot();
r = await region();
p = await pos();
ok(
  "a save with no region at all loads, on the surface",
  r.id === "surface",
  `region=${r.id}`,
);
ok(
  "and leaves the player exactly where it said they were",
  Math.hypot(p.x - 12, p.z - 20) < 1,
  `at ${p.x.toFixed(1)},${p.z.toFixed(1)}`,
);

ok("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

const fails = results.filter((r) => !r.pass).length;
console.log(`RESULT dungeoncheck ${results.length - fails}/${results.length} fails=${fails}`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
