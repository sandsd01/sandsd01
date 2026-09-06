# Romestead-inspired Survival Game (MVP)

A standalone, browser-based 3D survival-crafting game inspired by
[Romestead](https://store.steampowered.com/app/1805320/Romestead/) (Steam
Early Access). This is a **completely independent project** living inside the
`sandsd01` repo — it shares no code, dependencies, or build tooling with the
POS/inventory app in `web/`/`src/`.

Single-player, no backend: all progress is saved to `localStorage` in your
browser.

## Stack

- [Three.js](https://threejs.org/) for 3D rendering
- [Vite](https://vitejs.dev/) + TypeScript for the dev server/build
- Plain DOM/CSS for the HUD and menus (no UI framework)
- No physics engine — simple circle-based collision and terrain-height
  sampling (see `src/utils/collision.ts`, `src/world/terrain.ts`)

## Assets

| What | Source | Licence |
| --- | --- | --- |
| Props, buildings and the player character | [Kenney](https://www.kenney.nl) — Mini Forest 1.0 | CC0 |
| Forge, anvil, workbench, barrel | Forge Parts by Don Carson | CC0 |
| UI type (Rubik, Cinzel) | [Fontsource](https://fontsource.org) | OFL-1.1 |
| HUD icons | [Lucide](https://lucide.dev) | ISC |

The Forge Parts pack ships as a single OBJ holding 49 unnamed groups laid out
in a row — an asset sheet rather than a scene. The groups carry generated names,
so the loader picks pieces out **by their index in the file**, which is stable
for a committed static asset; those indices were read off a rendered contact
sheet of all 49 rather than guessed. Its flat MTL colours are restated as
`MeshStandardMaterial` so these props take the sun and sky fill like everything
else instead of reading as stickers.

The GLB models live in `public/models/` and are fetched at runtime rather than
bundled, because they reference a shared `Textures/colormap.png` atlas by
relative path. `src/world/models.ts` loads them, and each model declares which
dimension to fit and the size to fit it to — the pack is authored against
roughly 1-unit tiles, which is not this world's scale, and "the right size"
differs by what the prop is (a tree is defined by its height, a floor patch by
how much of a grid cell it covers).

Any model that fails to load leaves its slot empty and the procedural geometry
the game shipped with stands in, so a missing file costs polish rather than the
world. `iron_vein` keeps its procedural mesh on purpose: its ore shards are the
only thing that says "there is metal here", and nothing in the pack carries
that signal.

Fonts are bundled locally rather than linked from a CDN — a blocked font URL
fails silently, and the HUD would drop back to `system-ui` with nothing in the
console to explain why.

## Running it

```bash
cd game
npm install
npm run dev      # http://localhost:5174
```

```bash
npm run build     # type-check + production build to dist/
npm run preview   # preview the production build
```

## Deploying

The game is deployed on Vercel from this repo, built straight from source —
there is no separate build artifact to commit.

The Vercel project is linked to the GitHub repository, so **every push to
`main` deploys automatically**; a pull request gets its own preview URL.

The wiring lives in `vercel.json` at the **repository root** rather than in the
dashboard, so it is visible and reviewable with the code:

| Setting | Value |
| --- | --- |
| Install Command | `npm install --prefix game` |
| Build Command | `npm run build --prefix game` |
| Output Directory | `game/dist` |
| Framework | `null` (nothing to detect at the repo root) |
| Production Branch | `main` |

The install command is scoped to `game` on purpose: an install at the
repository root would pull the unrelated POS backend and run its
`postinstall` (`prisma generate`), neither of which this build needs.

Setting the project's Root Directory to `game` in the dashboard instead works
just as well — Vercel then auto-detects Vite and ignores the root
`vercel.json`. Either arrangement builds correctly; the file just means a fresh
clone deploys without anyone having to configure the dashboard first.

`npm run build` type-checks before bundling, so a type error fails the deploy
rather than shipping a broken build. Nothing here reads an environment
variable — the game is fully client-side and persists to `localStorage` — so
there is no deploy-time configuration to keep in sync.

## Controls

- `WASD` — move, `Shift` — sprint, `Space` — jump, mouse — look
- **Left mouse (hold)** — chop/mine whatever the crosshair is on, take down a
  building you are aiming at, or swing at whatever else is there
- **Right mouse** — place the selected build piece, swing the aimed gate open or
  shut, open the aimed barrel, eat what you're holding, or plant/harvest the
  aimed plot
- **Left mouse with a bow in hand** — loose an arrow, instead of swinging
- Scroll — change which item you're holding, `Ctrl`+scroll — zoom the camera
- `F5` or `V` — switch between third and first person
- `E` — gather what you're aiming at, falling back to the nearest node in range
- `F` — plant a selected seed into a farm plot / harvest a ready crop
- `1`–`8` — take that hotbar item in hand
- `R` — rotate the build piece you are placing
- `G` (hold) — repair the damaged building you are aiming at
- `Q` — cancel building placement
- `C` — crafting, `B` — building menu, `Tab` or `I` — inventory (select seeds here)
- `K` or `P` — character sheet: level, experience, and where to spend points
- `Esc` — close the open menu, or open Options when nothing is open

Click the canvas to lock the pointer for mouse-look.

### Aiming

Everything you can act on is chosen by **what the crosshair is on**, not by what
happens to be nearest — the convention this genre runs on. One raycast a frame
(`src/systems/targeting.ts`) answers "what is the player looking at?", and
gathering, combat, farming and placement all read that one answer.

Three details make it behave rather than merely work:

- **Reach is measured from the character, not the camera.** In third person the
  ray starts several units behind them, so a camera-relative reach would let you
  chop a tree standing at your back. Anything past 5 units, or on the wrong side
  of the player, is not a target.
- **Aim assist is a distance, not a cone.** A target within a metre of the line
  of sight can be picked when the ray slips past it. A fixed angle measured from
  a camera that sits behind the player is both too tight far away and too loose
  up close.
- **Ground never wins over something you can use.** Terrain is under the
  crosshair almost always, so it is the last thing considered, not the first.

What you're aiming at gets a wireframe box around it, the crosshair changes
shape for it (square = resource, diamond = enemy, bracket = ground or plot), and
holding the button fills a ring around the crosshair — one full ring per hit, so
a four-hit tree is four rings.

The camera pivots just above the character's head rather than at their chest, so
the crosshair line clears their body — otherwise you'd be aiming through your own
head and the placement ghost would sit behind it. The character still stands at
screen centre in third person, so first person (`F5`/`V`) is the precise mode.

**Mouse buttons are not rebindable.** Bindings are stored as
`KeyboardEvent.code` only; supporting mouse buttons means widening that type,
which is a separate change rather than something to slip in here.

These follow the conventions of the genre rather than inventing new ones, so
the bindings a player arrives with mostly work: `Space` jumps, `Esc` backs out
of menus and doubles as the options screen, `Tab` and `I` both open the
inventory (the genre is split between them), only one menu is open at a time,
and movement stops while one is.

**Every key above is rebindable** from Options, with two slots per action so a
split like `Tab`/`I` survives. Bindings are stored as `KeyboardEvent.code`,
which is layout-independent — a binding made on AZERTY still means the same
physical key. Gameplay code only ever asks about named actions
(`src/state/keybindings.ts`), never about key codes, so nothing needs changing
when a player rebinds. Options also carries look sensitivity and invert-Y.
Preferences are stored separately from the save so they survive starting a new
world.

Sprinting and jumping draw on **stamina**, which regenerates after a short
pause; emptying it locks sprinting until it has recovered a quarter of the way.

## Crafting

Crafting is **instant** — there is no timer and no queue, by choice. Waiting on
a progress bar to hand over something you have already paid for is the most
complained-about pattern in this genre's crafting, and the recipe data no
longer carries a duration field pretending otherwise.

### Learning recipes

You do not start with the book. A recipe is **learned the first time you hold
one of its ingredients**, so the panel grows with the world instead of opening
as a wall of things you cannot make. A new world knows only `Plank` — the one
recipe that turns a raw gathered thing into the input for everything else, and
whose row reads `Needs: x Wood 0/2`, which tells you where to go.

Newly learned recipes carry a **NEW** badge that stays until you close the
panel. The toast that announces them is deliberately a single summary line
("3 new recipes") rather than one per recipe: the HUD has one toast element
that overwrites itself, so a burst would leave only the last one readable.
Once learned, a recipe never disappears — an unaffordable one stays listed and
says what it is short of.

### Stations

Each station has its own job, and all three now gate something:

| Station | Makes |
| --- | --- |
| *(none)* | Plank, Axe, Pickaxe, Sword, Wheat Seeds |
| **Forge** | Iron Ingot |
| **Anvil** | Iron Sword |
| **Workbench** | Iron Axe, Iron Pickaxe, Bread |

A station counts as available within 5 units of where you are standing. A
recipe blocked by a missing one says so in words next to the disabled button
rather than just greying out.

### Tools and food

Iron tools are not a nicer label on the same swing: `src/data/tools.ts` gives
each tool a speed multiplier, and an iron axe fells a tree in 270ms against a
plain axe's 450ms. The requirement is on the *kind* of tool, not the item id,
so an upgrade is never a downgrade.

`Bread` is what farming is finally for — wheat previously had no use but
growing more wheat. Anything with a `heals` value can be eaten from the
inventory panel.

### Reading a row

A row shows its category glyph, what it makes, and what it costs. An
ingredient you are short of is marked `x` as well as tinted red: `1/3` and
`5/2` are the same shape at a glance, so the colour was carrying that on its
own — which is exactly what the rest of this HUD refuses to do. Filter chips
narrow by category, and **Craftable now** hides everything you cannot make
this second. `Craft xN` names the real number it will make, so the cost of
pressing it is visible before you press it.

A **mini-map** in the bottom-right corner shows the biomes, nearby resources,
your buildings and any enemies, north-up with a marker for your heading.

## Holding things

You hold **one item at a time**, and what's in your hand is what decides the
outcome — the Minecraft convention. This used to be untrue in both directions:
combat read `hasQty(state, "iron_sword", 1)` and gathering scanned the whole bag
for the best tool, so *owning* a thing was the same as *using* it and a crafted
sword changed nothing at all on screen.

Now an axe in your bag chops nothing while you're holding a sword. The prompt
says **"Hold an axe to chop this"** rather than "Need an axe", because the
difference matters: you have one, you just aren't holding it.

- `1`–`8` or the scroll wheel pick the slot. A new kind of item drops into the
  first free slot on its own, so the bag never has to be arranged before
  anything can be used.
- Once the bar fills up, the **Hold** button on any inventory row puts that item
  into the slot you have selected. Without it a sword crafted late — when every
  slot is already taken by wood and stone — could never reach your hand.
- Axes, pickaxes and swords are drawn in the character's hand and swing when you
  do. The rig has no hand bone (`arm-right` is a leaf whose origin sits at the
  shoulder), so the item hangs off the character root at a fist offset and is
  pitched by hand during a swing. Attaching to the bone was tried first and
  abandoned: any offset far enough out to clear the torso rides an arc as the
  arm animates and swings back inside the body.

## Barrels

A barrel is real storage, not scenery. Aim at one and right-click to open a
two-column panel — your bag on one side, its contents on the other, click to
move things across. Contents are keyed by the barrel's placed-building id and
live in the save, so they survive a reload.

## Getting your bearings

The world used to be divided by straight lines through the origin
(`z < 0 ? wetland : x >= 0 ? forest : rocky`) and contained no landmarks at
all — nothing to steer by and nowhere to aim for.

- **Borders wander.** Zone edges are domain-warped with the existing value
  noise before the zone test, so a biome boundary is a meandering coast rather
  than a ruled line. The spawn clearing stays a true circle, because building
  rules depend on it.
- **Six landmarks in two rings, two per biome.** The near ring — the Bleached
  Giant, the Spire and the Standing Stones — stands 58–96 units out and well
  above the treeline, each differing from its surroundings in *shape and
  value*, not only in size. The existing fog (`Fog(0x9fd0e8, 95, 250)`) gives
  them atmospheric perspective for free. They are checked by looking at renders
  from spawn, not by reading the diff: the Giant was widened after a render
  showed it reading as just another trunk.
- **The far ring** — the Ashen Grove, the Fallen Obelisk and the Drowned
  Pillar — stands 130–175 units out, past the fog and so **invisible from
  home**. That is deliberate: the near ring is what you steer by, the far ring
  is what you find. The fog was left exactly where it was, because it is the
  horizon and not the size of the map.
- **Each has a stocked cache at its foot**, so arriving pays for the walk and
  the barrel system has a purpose from the first minute. A far cache is worth
  substantially more than a near one and is the only cache that holds ancient
  stone. **They refill** ~2 in-game days after being emptied
  (`GameState.pois`, an absolute time on the `elapsedMs` clock like
  `RaidState`), and never while the player is standing within 40 units —
  watching a barrel fill itself is the moment it stops being somewhere
  abandoned and becomes a spawner. A cache with anything in it has no timer at
  all, so a barrel the player has adopted as their own storage is never topped
  up on top of what they left there.
- **What you have walked up to is remembered** (`GameState.discovered`), and
  the minimap keeps a hollow-diamond pin for it clamped to the rim of the map
  once it is out of the 70-unit range — a different *shape* from the in-range
  triangle, so "there" and "that way" are never the same marker. Without it,
  finding a far landmark a second time would be exactly as hard as the first.

## The frontier

The world is **400 × 400** (it was 200), with the terrain mesh at 192 segments
rather than 128 so the quad stays ~2.1 units and the hills near the homestead
do not come out coarser as a side effect of somewhere far away getting bigger.
Resource scatter is stated as **attempts per square unit** rather than a flat
count, so four times the area means four times the trees rather than the same
trees a quarter as thick — and the rejection test is bucketed by grid cell,
because the old O(n²) scan was invisible at 900 attempts and is not at 3,600.

The reinforced wall gets its own geometry rather than the generic wall panel,
and the reason is worth recording because it is invisible in a diff. Rendered
as a plain panel beside a brick wall in the same light, the *lit* faces came
out near equal (luminance 113 against brick's 121) and the *shaded* faces did
not — 70 against 105. Warm saturated brick keeps its identity in the scene's
cool ambient shade; a desaturated cool grey has none left to keep, so the most
expensive piece in the game read as a hole cut out of the world. It carries the
material by **pattern** now — the pale inlaid bands and capstone that the
ancient stone node wears — which survives any light the scene puts on it and
says "the same stone you quarried" rather than "a different grey".

- **`ancient_stone` spawns only at radius ≥ 120** (`FRONTIER_RADIUS`), in every
  biome, and nowhere closer. It is the one material distance buys, and it is
  spent on the *base*: `reinforced_wall` (700 health, against brick's 300) and
  `heavy_trap` (22 damage a bite, against the spike trap's 6). Deliberately not
  a third suit of armour — the player's own numbers stop climbing at iron
  armour by design, and the homestead is what grows after that.
- **Danger rises with distance.** Wandering enemies now spawn on a ring around
  the **player** rather than around the world origin. On a 400-unit map the old
  rule made walking away from spawn the safest thing you could do: every
  wanderer in the game would appear back at the homestead and never reach you.
  The interval shortens from 9s near home to 3.5s out past 150 units, and the
  share of brutes climbs from none to about two thirds. The eight-wanderer
  ceiling holds everywhere.
- **The world has an edge you cannot walk off.** `Terrain.heightAt` is a noise
  function and answers for any coordinate, mesh or no mesh, so a body past
  ±200 used to stand on ground that was never drawn — no fall, no death,
  nothing in the game noticing. `clampToWorld` in `world/terrain.ts` is now the
  single definition of where the world stops, clamping **per axis** so a body
  slides along the boundary the way it slides along a wall rather than being
  pinned where it first touched. Both writers of the player's position funnel
  through one `setGroundPosition` so the rule sits on the path everything
  takes, including the debug teleport — a hook that could put the player
  somewhere the game cannot is a hook that tests something that will never
  happen. Enemies are clamped in their per-frame step, beside the
  ground-height line, for the same reason it is there: clamping only the walk
  would leave one that is standing still off the map standing still off the
  map. The player's 3-unit margin was picked by walking to the edge and
  looking — at 1 unit the body stopped on the lip with no ground ahead of it.

- **No enemy is quietly buffed for being far out.** A brute has the same health
  and damage at radius 10 as at radius 190. The frontier is harder because more
  of what walks out of it are brutes — which the player can read off the
  silhouettes — not because the game rewrote the numbers behind the same model.
  Same principle the raid schedule follows.

## Fighting and gathering pay out

Killing something used to give nothing at all — the `enemy-killed` event had a
single listener and it played a sound — so combat was a pure cost: health and
time spent for a quieter field. And every resource node yielded exactly 1 per
swing, forever, so a better tool only ever meant *sooner*, never *more*.

- **Enemies drop loot on the ground** at the corpse, and you walk over to pick
  it up. Tables are per enemy (`src/data/loot.ts`) with independent per-entry
  chances, so a brute is reliably richer than a zombie rather than merely
  slower to kill. Drops fade and vanish after a minute, and are deliberately
  **not saved** — they belong to the fight that just happened, and a reload has
  already thrown that fight away.
- **Bone and Hide** are the two things only the dead carry, and both feed
  recipes: a **Bone Club** (a weapon between the plain sword and iron, so the
  first real upgrade can come from fighting rather than from finding iron) and
  **Broth**, which doubles a food category that had exactly one recipe in it.
- **Yields vary per swing**, each node kind has a small chance of something
  else entirely, and **the blow that fells a node pays a bonus** — finishing a
  tree beats tapping four different ones once each.
- **Iron tools bring back more, not just faster.** `ToolDef.yieldBonusChance`
  gives the iron tier a second dimension; measured over 20 trees each, an iron
  axe returns roughly 30% more wood than a plain one.

Feedback for all this deliberately avoids the toast: it is a single
self-overwriting element (which is why crafting batches its messages), so
announcing every pickup there would bury everything else under resource spam.
A resource count that rises gets a brief lift on its HUD chip instead. Kills
are rare enough to earn a toast.

## Building is editable

- **Anything placed can be taken back down**, refunding its full cost — hold
  the left button on it. Nothing could be removed at all before: `occupancy`
  and `meshes` were only ever written to and `placedBuildings` only ever
  pushed, so a piece put down in the wrong cell was wrong for the life of the
  save. Demolishing a stocked barrel **tips its contents onto the ground** as
  ordinary drops rather than deleting them or force-feeding them to you.
- **Pieces rotate** with `R`, in quarter turns. Every fence in the world used
  to face the same way — `PlacedBuilding` had no such field.
- **A piece can cover more than one cell.** `footprintCells` and everything
  that walks it were written for this from the start and then never used;
  every building was 1x1. The Long Wall is the first that isn't.
- **Walls are solid, and floors are floors.** Collision was one circle at the
  anchor cell: a multi-cell piece only blocked its first cell, and a run of
  walls had a gap at every corner where the inscribed circles failed to meet.
  It is now a box per occupied cell, and a face with a neighbour behind it is
  excluded from push-out so arriving fast at a seam stops you instead of
  sliding you into it. A `foundation` — a floor slab — no longer blocks the way.
- **Walls are aimable**, which is what demolition needs and also what stops the
  crosshair reaching through a brick wall to chop the tree behind it.
- **The ghost tells the truth.** It shows every cell the piece will occupy, at
  the height the piece will really stand — that came off `def.height`, which is
  design intent and not what gets built. A Wall is declared 2 units tall and
  the fence model placed for it is 0.35.

The Build panel now has category chips and per-type icons, and a piece you
cannot yet afford is still selectable so its cost can be read — matching what
the crafting panel already did, instead of hiding the price behind a dead
button.

## A base you can live in

Making walls stop raiders left the game needing three things it did not have,
and the first one was a hole the raid work dug itself.

**A gate.** Walls stop the player too, so a ring of wall was a cell: seal it and
you are inside for good, leave a gap and the gap is exactly where the raiders
walk in. Right-click swings one. Shut, it is a wall in every respect — it
blocks, it gets beaten on, it can be repaired. Open, it is not in the collidable
list at all. **Nothing in the enemy code knows what a door is**, which is the
point: they beat on a shut one because it is in the way and walk through an open
one because it isn't, and they are still only ever chasing the player.

`blocksAt` has to agree with `getCollidables` about this. That method is what
decides a neighbour's `openFaces` — skip the door in one and not the other and
the walls beside a propped-open gate get their diagonal seam back.

**A bow.** Standing behind a wall used to mean not fighting; the only weapons
were melee, and the character has been a `character-archer` model since the
first commit. Arrows are real projectiles with travel time and a little drop,
so you aim ahead of a moving raider and can lob one over a low wall.

- Arrows are crafted (a plank and a stone make four) and **a spent one lands on
  the ground as an ordinary drop**, so ammunition is a loop rather than a
  countdown. That reuses the drop system whole — pickup, fade and the 60-second
  despawn all come free, and the despawn is deliberate: the floor does not fill
  up, and "fire everything and collect it later" is not free.
- The bow is deliberately **absent from `WEAPON_DAMAGE`**: swung as a club it is
  worth no more than a fist. Left in that table it would be a sword that also
  shoots and there would be no reason to carry anything else.
- Collision is tested along the **segment** flown this frame, not at the point
  the arrow ended up. `GameLoop` clamps dt at 0.1s, so under software rendering
  an arrow covers three units in a step — several times an enemy's width — and
  a point test would let every shot pass cleanly through what it was aimed at.
  The miss would look like bad aim rather than a bug.

**Spike traps.** The first thing you build that does something to a raider
rather than merely standing between them. Declared low enough to fall under
`WALKABLE_HEIGHT`, so it is not a collidable and raiders walk over it — they
were coming that way anyway. It never wears out and hits for very little, so a
line of them in front of the gate wears a wave down without playing the raid for
you. **It never hurts the player**: at night, backing through your own gate, you
cannot see which tile is which, and the raiders never had to choose where to
walk.

## Somewhere to get to

The game had every verb it needed and no direction. `PlayerState` held health
and stamina and nothing else, so the ceiling of a whole character was an iron
sword; the raid schedule was a fixed three-wave array, so raid 3 and raid 30
were the same night; and nothing on screen said how far you had got.

**Raids escalate, and never stop.** `planFor` builds every raid from the number
of raids already survived: more waves, bigger waves, and a rising share of
brutes. Escalation is in **numbers and composition only** — an enemy that looks
identical but quietly carries more health on raid ten is the game lying about
what it is showing you.

Two things fall out of a fixed-length night:

- **The gap between waves shrinks as raids grow.** A raid runs for a fixed
  `RAID_DURATION_MS` and ends at dawn whatever is standing. Left at a flat forty
  seconds, the later waves of raid twelve would never be released before sunrise
  and raid twelve would come out *easier* than raid six, with nobody having
  decided that.
- **Raiders a wave cannot fit are carried forward.** `RAID_MAX_ENEMIES` caps how
  many can be on the field at once and stays — it is what keeps the frame rate
  honest. Without a backlog the surplus would evaporate, and past the point
  where the field saturates every raid would be identical however far the
  schedule had climbed. Queued instead, the pressure keeps rising as a field
  that never empties.

**Armour** is the one thing that scales on the player's side: hide (-20%) then
iron (-40%), applied in `damagePlayer` — the single place health is ever lost,
so anything that hurts you later gets the reduction for free. Floored at 1 a
hit: armour that could take a blow down to nothing would end the game rather
than deepen it. Worn gear is **out of the bag** — a piece that was both worn
and carried could be spent by a recipe while it was keeping you alive. It sits
in one of three slots now; see **Found gear** below for why that changed.

Gear tops out at two tiers and the raids do not, which means the player loses
eventually. That is deliberate: what keeps scaling is the *base* — thicker
walls, more traps, more arrows — so the number that matters is how many raids
you saw through. It is on the raid banner ("Raid 9 — wave 1/6") and the day is
on the clock, rather than sitting in the save where only the code can read it.

## Down the hole

There is a second place now. Three boulder arches stand out in the rocky
ground, each with a glowing ring in front of it, and walking into one puts you
in a cave. Walking into the ring at the other end puts you back at the arch you
came in by. No key, no prompt: you walk at it and you are somewhere else.

The whole feature is one architectural move. The game was written on the
assumption that there is exactly one place — `heightAt` is reached for from
eleven files, and terrain, grass, water, nodes, landmarks, buildings and
farming are all built once at boot and held by reference forever. Threading
"which place" through all of that would have been a very large diff. Instead
`world/region.ts` declares a `GroundSurface` interface (`Terrain` already
satisfied it) and `RegionManager` **implements that interface itself**,
delegating to whichever region is active. Every system keeps the single
reference it was constructed with, and none of them ever learns that a switch
happened.

What the region *is* carries the rest: its ground mesh, its nodes, its portals,
its lighting, its spawn rules, and its half-extent — so the world-edge clamp
that stops you walking off the overworld is the same clamp that stops you
walking through the wall of a cave, just asked a different number.

Four decisions shape the design, and each of them cut work rather than adding
it:

- **The cave resets on every entry.** Nothing about its contents is saved; a
  fresh seed builds a fresh cave each time you go down, and the old one is
  disposed on the way out (three.js does not reference-count, so a group that
  is merely dropped leaves its buffers on the GPU). The save holds two fields:
  which region you are in, and where to come back out.
- **You cannot build or farm down there.** `BuildingSystem` and `FarmingSystem`
  are switched off wholesale rather than having their UI hidden, so the rule is
  true of the debug hooks and of any call site added later.
- **The raid clock is held, not the world clock.** Underground,
  `RaidSystem.defer` pushes the whole schedule forward by the clock's own step
  each frame — so two minutes in a cave neither skips a raid nor banks one.
  Crops keep growing, nodes keep respawning and caches keep restocking, because
  freezing `elapsedMs` outright would have quietly stopped all three.
- **Quitting underground puts you back at the mouth.** The cave you logged out
  of no longer exists, and the new one generated in its place could put you
  inside a rock.

What the trip is for is **glow crystal**, found nowhere else, and the
**brazier** it buys: a standing light you can place around the homestead.
Darkness is the oldest threat in this game — a raid has been survivable since
the first wall went up, and the field at night has never been *visible* — and
nothing you could craft has ever answered it. Braziers are capped at eight live
`PointLight`s (every one widens the uniform arrays each material's shader is
compiled against); past that the flame still draws, so the piece never silently
changes appearance.

Three things in here were found in screenshots and by nothing else:

- The chase camera collides only with the ground, so an arrival point directly
  in front of a portal put the camera **inside** it — the first frame in the
  cave was a screenful of flat amber, and walking back out was a screenful of
  purple. Both arrival points now stand well clear of their portal.
- The first lighting pass ran fog from 6 to 44 over a near-black floor. The
  numbers looked like "a cave"; the screenshot was crystals floating in a void,
  with no ground legible even at the player's feet.
- The arches were rotated with `atan2(-x, -z)`, which turned each one's back on
  the player and stood it in front of its own portal.

Hiding the overworld is measured, not assumed: 938 draw calls and 236k
triangles on the surface, 188 and 49k inside the cave, on the same world.

## Up the tree

There is a third place, and getting to it is the same walk-into-a-ring as the
cave. What is new is what happens at the edge.

**The tree is the first thing this game ever built to be looked at from the
homestead.** It stands about a hundred units out, forty-six of trunk and a
canopy on top of that, in pale weathered bark against a forest of mid greens
on warm brown. Size alone did not do it: the first pass was eighty units away
and read, in the screenshot, as an ordinary trunk that happened to be nearer.
The Bleached Giant hit exactly this problem and answered it the same way — the
silhouette stays a tree, but plainly not one of *these* trees.

**The island has an edge you can walk off**, and that is the one genuinely new
mechanic in either dungeon. It rests on a single line in `updateVertical`:

```ts
if (this.state.player.y - groundY > STEP_DOWN) { this.grounded = false; ... }
```

Without it, `player.y = groundY` teleports a grounded body down whatever drop
appears under it. That was invisible while the only surface in the game was
terrain, which never falls away faster than you can walk. It is the same bug at
the rim of a floating island and at the side of a rampart, and this is the one
line that answers both. Falling past `SKY_FALL_LIMIT` costs 35 health and puts
you back at the foot of the tree — the drop is a mistake anyone makes once, and
dying to it would cost the trip as well.

**The rampart** is what `cloud_iron` buys: the first vertical thing in the game.
A *tower* was the obvious shape and does not work — the grid is one unit a cell,
a jump clears 1.11 units (`JUMP_SPEED²/2·GRAVITY`), and pieces do not stack, so
a platform high enough to matter would have needed a climbing mode this game
does not have. A ramp needs none: you walk up it exactly as you walk up a hill,
because a grounded body already follows its floor.

Three things had to be true for it to work, and each is an existing rule made
to do slightly more:

- **`getCollidables` now answers differently for the player and for the
  raiders.** Everything else in that list is shared on purpose, so neither side
  gets a world the other cannot see. A rampart is the exception and the reason
  it exists: you walk up it and they cannot.
- **It is solid per cell, by how big the step up is.** That is the
  `WALKABLE_HEIGHT` rule that already stops a foundation being a wall, measured
  from the feet instead of from the ground. Without the per-cell part, walking
  into the tall end from below snapped the body 2.4 units up the side — the
  exact mirror of the drop `STEP_DOWN` exists to stop.
- **Enemy reach became a cylinder rather than a circle.** It was
  `hypot(dx, dz) <= attackRange` with height ignored entirely, which was fine
  while every fight happened on the same ground and wrong the moment the player
  could stand on something. A zombie at the foot of a rampart would have gone
  on hitting them two and a half units above its own head.

So the bow finally has a job the walls could not already do.

Two things in here were found only in screenshots. The island was first built
as a square `PlaneGeometry` with everything off it pushed down to a floor,
which put a seventy-eight-unit dark skirt across the whole horizon — reading as
"the ground goes on, darkly" exactly where the answer had to be "there is
nothing there". And its first lighting ran fog from 40 to 170 over a
sixty-unit island, washing the whole place to near-white so the drop past the
rim read as haze rather than as height.

## Levels, and what a point buys

A raid lands every eighteen minutes and, before this, **nothing at all happened
in between**. Every fight in that gap cost health and time and paid in a
quieter field. Levelling is the fast reward loop that gap was missing, and the
raid schedule — which escalates with the nights survived and has no ceiling —
is the counterweight that keeps it from trivialising the game: your power goes
up, so does the pressure.

- **Kills grant experience** (`EnemyDef.exp`: 8 for a zombie, 20 for a brute),
  hung off the same `enemy-killed` event as the loot, so the two things a kill
  pays out arrive together. An enemy that falls out of the world, or is swept
  away when you change region, pays **nothing** — that event is deliberately
  not emitted, because nobody killed those.
- **A level hands over three points to spend plus four health outright.** The
  automatic health matters: levelling has to feel like it did something to a
  player who has not found the character sheet yet. And it **refills health and
  stamina**, the way the genre this borrows from does — which is what makes a
  level land in the middle of a fight rather than in a menu afterwards.
- **Five stats, and every one of them multiplies a number the code already
  funnels through.** Not six copied across: this game has no magic and no
  criticals, so an INT and a LUK would have had nothing to attach to and would
  read on the panel as stats that do nothing.

| Stat | What it does | Where it attaches |
| --- | --- | --- |
| **Might** | +6% damage a point, in the hand and from the bow | `heldDamage`, `arrowDamage` |
| **Vigour** | +6 max health, and up to 35% of every hit absorbed | `recomputeMaxHealth`, `damagePlayer` |
| **Swiftness** | Faster on foot, faster to swing, faster to catch your breath | the move-speed line, `canAttack`, `regenStamina` |
| **Craft** | Quicker at a node and more out of it | `gatherTimeFor`, the yield roll |
| **Fortune** | The rare rows drop more often | `rollLoot`'s drop scale |

Fortune is the one that pays in *content* rather than in numbers, and it is
there to give a player hunting for gear somewhere to put their points.

**The curve is measured, not guessed.** Killing everything the spawner produced
over five game-minutes in each place gives **6.3 kills a minute near the
homestead and 16.7 out on the frontier** — the supply, not the fighting, is
what sets the pace, because at a mean spawn distance of sixty units even a
sprint costs about eight seconds against a nine-second spawn interval. Near
home that is roughly 50 exp a minute; on the frontier, with brutes common and
the interval down to 3.5 seconds, three to four times that. `expToNext(n) =
30 * n^1.1` (`src/data/levels.ts`) puts the first level at about 35 seconds and
the tenth at seven and a half minutes of home hunting — and that gap between
the two places is the point, because it means the curve can steepen without
ever stalling: the answer to "this is taking a while" is somewhere to go.

Arrow damage got a resolver (`arrowDamage`) in the process. `ARROW_DAMAGE` was
read straight out of the constant at the one place arrows land, which made the
bow the only weapon in the game that nothing could ever modify.

`maxHealth` is now rebuilt from level and Vigour by `recomputeMaxHealth` rather
than added to incrementally, including on load — it is a stored number with two
independent contributors, and anything incremental would drift the first time a
save was edited or the numbers retuned.

**Levelling up puts a light under your feet**: three rings off the ground and a
ring of beams rising through you, over about a second. It is built from
primitives — this game has no particle system and one flourish is not a reason
to start one — and it *glows* because the composer already carries an
`UnrealBloomPass`. That pass thresholds at 1.7 in linear HDR sampled before
tone mapping, so the colours in `src/world/level-aura.ts` are set above 1.0 in
linear space on purpose. Set to an ordinary cyan they come out as flat
translucent plastic; the difference was checked against a screenshot, not
assumed.

## Found gear, and the three slots it goes in

Fortune — the stat that was meant to "pay in content" rather than in numbers —
shipped with nothing to find: it multiplied a drop table of bone, hide and iron
ore, which are crafting materials. These four pieces are what it looks for.

**They cannot be crafted at any price.** There is no recipe for any of them
anywhere, which is the whole point: the forge covers the tiers you can plan
for, and this is the tier you go looking for.

| Piece | Slot | What it does | Where it attaches |
| --- | --- | --- | --- |
| **Stormcleave** | held | 52 damage, and hits *everything* in a 140° arc in front of you | `systems/combat.ts#cleave` |
| **Ember Cloak** | back | Whatever hits you takes 60% of it back | the enemy-attack callback in `main.ts` |
| **Quickdraw Ring** | trinket | Draws a bow in 45% of the time | `drawTimeFor` in `data/tools.ts` |
| **Gatherer's Charm** | trinket | One swing works every node of that kind within 4.5 units | `systems/gathering.ts#neighboursFor` |
| **Divine Wings** | back | Flight. Double-tap jump to start; jump rises, sprint sinks | `player-controller.ts#updateFlight` |

Two trinkets and one slot is a choice, not an oversight — the bow build and the
gathering build want different things, and having to pick is the point.

The wings and the cloak share the back slot for the same reason: reflecting what
hits you is worth most to someone standing in the middle of a raid, and flight
is worth most to someone who would rather not be. You cannot have both.

### Why three slots now

`state.armour` was a single field, and the comment on it argued *for* that:
"three slots is three times the UI, the save and the balancing for depth the
player cannot read off the screen anyway." That was right while a slot held a
percentage. It stopped being right when slots started holding abilities — "the
cloak that burns what hits me" is something a player can read off the screen in
a way that "40% instead of 20%" never was.

`data/armour.ts` was **deleted** in the process rather than kept alongside
`data/worn.ts`. Two tables describing the same two pieces of armour is how they
drift apart, and it is the same shape of bug as the debug hook that silently
dropped Fortune's drop scale — invisible, and agreeing with reality right up
until it doesn't.

### The rates are measured

Counting what the spawner actually produced: **2.3 brutes a minute near the
homestead and about 13.5 out on the frontier.** That gap is smaller than the
constants suggest — `BRUTE_SHARE_HOME` is zero, but `BRUTE_SHARE_ROUGH_BIOME`
floors the mix at half wherever the spawn ring reaches into rocky or wetland
ground, so about a third of what walks into the yard is already a brute. The
frontier is six times richer rather than infinitely richer, which is the right
shape: somewhere better to hunt, not a wall.

Against roughly nine brutes a minute of real frontier hunting, the rates
(0.6–1%, brutes only) put the first piece of *anything* at about three and a
half minutes and a *named* piece at eleven to eighteen — halved again by a
heavy Fortune build. The whole set is around half an hour.

### One thing that had to be widened

Ember Cloak needed to know who hit you, and nothing did. `damagePlayer` takes
`(state, amount)` and no source, and the `onAttackPlayer` callback discarded
the attacker at three separate levels even though it was in scope at the point
it fired. The callback was widened to carry it; `damagePlayer` was **not**,
because it is also how a fall hurts you and how the debug hook does — giving it
an attacker would force those callers to invent one. The reflection happens at
the one call site that genuinely knows, and a reflected kill goes through
`removeEnemy` like any other, so it still pays experience and loot.

## Flying

The wings are the rarest thing in the game — 0.4% from brutes, about
twenty-eight minutes of frontier hunting, or fifteen with a heavy Fortune build.
They are also the only item that changes how the game is *played* rather than
how hard you hit, which is why they are that rare.

Controls follow the creative-mode idiom players already have in their hands:
**double-tap jump** to toggle, **jump** to rise, **sprint** to sink, no gravity
in between, and touching down ends it. Flight costs no stamina.

- **The ceiling is forty units above the ground underfoot**, not above sea
  level. Flying over a hill should carry you over it rather than into it, and a
  fixed altitude would put the ceiling somewhere different depending on where
  you took off.
- **Sprint means "descend" while flying** and is deliberately excluded from
  `updateSprintState`. Left in, holding it to come down would drain the bar and
  then fire the exhausted sound all the way to the ground.
- **Taking the wings off in mid-air drops you**, checked before anything else
  in `updateVertical` so there is never a frame in which the player is flying
  without the thing that lets them.
- **Falling off the sky island no longer hurts a player wearing wings.** Anyone
  wearing them could have flown, so the fall is a choice rather than a mistake.

### What flight broke

Two range checks in this game were two-dimensional, which was invisible while
the only way to be above something was a jump:

- **The portal trigger.** Flying over a cave mouth teleported you into it.
- **The pickup radius.** Hovering over a battlefield hoovered it up.

Both now go through a single `heightAboveGround()` helper — two copies of "y
minus the ground" is one chance for them to disagree about what the ground is —
and both keep a jump's worth of tolerance, because jumping through a portal or
over a drop always worked and should keep working.

Also fixed: the falling clip played for as long as the player stayed airborne,
which is most of the time the wings are worn; and hovering at exactly ground
level could re-fire the landing sound every frame.

### Does this make raids free?

Yes for you, no for the homestead — and that was measured, not assumed, because
`REACH_HEIGHT` is 1.6 and anything above it is untouchable. Hovering at seven
units over eleven raiders, **the player took no damage at all and a wall took
fourteen**. Enemies attack whatever blocks them, so the night still costs walls.

(The first run of that experiment said the opposite. It advanced the world clock
to pass the time, and enemies walk on the frame's `dt` rather than on the clock
— so nobody had moved, and it reported "raids are free" for entirely the wrong
reason. Worth recording as the shape of mistake this codebase invites.)

### Where the wings sit

On the character root, not on a bone. The rig carries seven joints and none of
them is a back; `world/held-item.ts` records the sweep of offsets that
established this for the sword. The trade is more forgiving here — wings that do
not counter-rotate with the torso read as stiff, where a sword that did it swung
inside the body.

Their size and colour came from a screenshot rather than arithmetic. At the
first attempt they read as two dark stubs at shoulder height: the fix was
roughly double the span, a fan that opens *upward* so it stands against the sky
instead of vanishing into the character's own silhouette, and a faint emissive,
because thin panels edge-on to the sun came out near-black however pale the
albedo was.

## Raid night

Every third night, something comes for you. Before this the day/night cycle was
lighting and nothing else — the comment at the top of `systems/day-night.ts`
said so — enemies trickled in at the same rate around the clock, and there was
never a reason to be home by dark or to have built anything.

- **You are told first.** A horn and a message a minute out, then a banner in
  the HUD naming the wave and how many are left. A night that kills you without
  warning reads as the game cheating, not as tension.
- **Three waves, escalating in composition.** Four zombies, then six with a
  brute, then eight with three. More zombies is a longer night; more brutes is
  a harder one — and brutes drop the better loot, so the night pays.
- **Waves land on a ring around you**, not around the world origin the ambient
  spawner uses. A homestead built out past the ridge would otherwise be raided
  by enemies who spawn back at spawn and never arrive.
- **Dawn ends it** whichever way it is going. Without that backstop one raider
  wedged behind a boulder on the far side of the map would hold you in a raid
  that never finished.
- **A reload does not skip it.** The raid is in the save; enemies never were.
  Coming back mid-raid puts you back in it and releases a fresh wave, because
  otherwise reloading would be the cheapest escape in the game.

Timing lives on absolute positions on the `elapsedMs` clock (`RaidState`),
never on a day index. The `setTimeOfDayFraction` debug hook winds that clock
*backwards*, and a counter derived as `floor(elapsedMs / DAY_LENGTH_MS)` would
walk back with it and re-run a raid that had already happened. An appointment in
the future just stays in the future.

## Enemies meet walls now

`systems/enemy-ai.ts` never imported `collision.ts`. Enemies wrote straight to
`object.position`, so **every wall in the game stopped the player and no one
else** and a base was scenery you could admire while being eaten inside it.

They are now resolved against the same collidable list the player is, and a
blocked enemy takes a swing at whatever stopped it. They still chase the player
and only the player — nothing picks out a base to besiege; they hit what is in
the way, which is the version you can read at a glance from inside the walls.
Only things you built can be broken: a boulder or a tree answers "nothing
breakable here" and the enemy goes on sliding along it as before.

- Every piece has `maxHealth` (Wall 120, Brick Wall 300, Long Wall 200), stated
  per piece rather than derived from cost — what a thing costs and how well it
  holds a line are different questions.
- A piece beaten to zero is **destroyed with no refund**, unlike one you take
  down yourself. Both go through the same teardown (`removePlaced`), because
  five separate structures key off a building's id and the last time one was
  missed, a new barrel opened holding an old barrel's contents. A smashed
  barrel spills its contents on the ground exactly as demolishing one does.
- **Repair costs materials in proportion to the damage** — half a wall is half
  the planks, rounded up, never free. Hold `G` on it; the prompt reads the
  remaining health and the price before you commit.

Damage shows as a lean and a slight sink, with **neighbouring cells leaning
opposite ways** so a battered run reads as ragged rather than as a fence that
was built crooked. The numbers there are small and have to stay small: a first
pass leaned pieces 0.17rad and sank them 0.18 of their height, which looked
right and swung the top of the silhouette clean out of the crosshair's line —
a nearly-destroyed brick wall could not be aimed at from any distance, so the
one piece most in need of repair was the one piece that could not be repaired.
It is also transform-only, never a material tint: `instantiate` uses
`Object3D.clone(true)`, which shares materials, so reddening one wall reddens
every wall built from the same model.

## What the save holds

Everything gameplay-relevant goes into one `localStorage` key
(`romestead-save-v1`), written every 10 seconds and on unload: the world seed
and clock, the player, inventory, hotbar, placed buildings (with how battered
each one is and whether a gate is standing open), crops, known recipes,
container contents, the raid schedule and how many raids have been survived,
what is in each of the three worn slots, **your level, experience, unspent
points and where the spent ones went**, and **how far each resource node has
been worked**.

That last one is newer than the rest, and its absence used to be exploitable:
nodes were re-scattered from the seed on every boot, so reloading the page
restocked the whole world — faster than waiting out a tree's 20-second respawn.
The record is deliberately sparse (an untouched node is simply absent, so a
fresh world writes nothing) and `depletedAtMs` rides the same saved `elapsedMs`
clock the respawn check reads, so a timer carries on across a reload instead of
restarting.

Two things that follow from ids being load-bearing, both fixed and both worth
knowing if you touch this code:

- Building ids (`building-N`) are issued from a counter **seeded from the loaded
  save**, not from zero. It was module-level before, which meant the first piece
  placed after a reload reused a live id — and since `state.containers` is keyed
  by that id, a newly placed barrel opened holding an older barrel's contents.
- Node ids are stable across boots only because scattering is deterministic from
  the seed and happens exactly once per page load. Restoring skips ids it does
  not recognise, so a save from a different seed degrades to "untouched" rather
  than throwing.

A save written before the three slots keeps its armour: `state.armour` is moved
into `worn.armour` and then **deleted**, because two fields describing what is
on the body is how they drift apart. The slots are guarded **per slot** rather
than as a record, for the reason the next paragraph gives.

`player.level` and `player.exp` cost no migration code at all: `backfillDefaults`
walks every numeric field of `player` and fills in whatever a save is missing.
`statPoints` and `stats` are not numbers on `player` and need their own guards —
and `stats` needs a guard **per field**, not one on the whole record, which is
the lesson `raid.count` taught: a whole-object check silently skips a save that
has the record but lacks a field added later.

Preferences (`romestead-settings-v1`, `romestead-keybindings-v1`) are stored
outside the save on purpose, so they survive starting a new world. **Options now
has a "Start a new game" button** — `clearSave()` had existed since save/load
shipped and nothing had ever called it, so the only way to begin a second
character was to know what `localStorage` is. It arms on the first click and
wipes on the second, and switches the periodic save off before reloading, or
the world it just erased would be written straight back on the way out.

Building moved off the number keys into the `B` panel when the hotbar became
items. That does make laying several pieces slower than it was; if it grates,
the fix is one bar holding both items and build pieces, the way Minecraft
treats blocks as items.

## Scope (MVP)

Implemented: resource gathering (trees/rocks) + crafting, grid-based building
placement, crop farming (plant → grow → harvest), enemy (zombie) combat with a
simple spawn/aggro/attack AI, a day/night cycle (`src/systems/day-night.ts`,
purely visual — sky/light color and intensity on a ~6 minute loop, shown in
the HUD clock), and save/load to `localStorage`.

Explicitly **out of scope** for this MVP (see
`/root/.claude/plans/romestead-memoized-charm.md` for the full plan/reasoning):

- Multiplayer/networking
- Infinite/streaming procedural terrain (this uses one fixed-size seeded
  heightmap instead)
- Multiple distinct biomes with terrain shaders, procedural dungeons
- Animal husbandry (crop farming only)
- Anything gated on time of day (e.g. night-only enemy spawns) — the cycle is
  visual only for now

## Project layout

```
src/
  core/       scene, renderer, camera, game loop, clock
  input/      keyboard + pointer-lock mouse-look
  player/     movement/collision, health
  world/      terrain heightmap, noise, biome zones, resource nodes
  systems/    inventory, gathering, crafting, building, farming, combat,
              enemy AI, save/load — the actual gameplay logic
  data/       content definitions (items, recipes, buildings, crops, enemies)
              — add new content here, not by editing systems
  state/      the single serializable GameState every system reads/writes
  ui/         HUD + panels (plain DOM/CSS, no framework)
  utils/      grid math, seeded RNG, collision, event bus
```

## Verification

There's no unit-test suite for this MVP (the surface is small and heavily
visual/interactive). Verify changes by actually running `npm run dev` and
playing: gather resources, craft an item, place a building, plant/harvest a
crop, and fight off a zombie. A `window.__gameDebug` object is exposed in the
browser console for quick manual or scripted (e.g. headless Playwright)
checks — `getPlayerPosition()`, `getInventory()`, `getEnemyPositions()`,
`getResourceNodes()`, `getPlots()`, `getPlacedBuildings()`,
`teleportPlayer(x, z)`, `isPointerLocked()`, `getTimeOfDay()`, and
`setTimeOfDayFraction(fraction)` (jump the clock to any point in the day/night
cycle without waiting out the full ~6 minute loop).

For the held item and the world there are also `getHotbar()`,
`getEquippedSlot()`, `getEquippedItem()`, `selectHotbarSlot(i)`,
`holdItem(itemId)`, `getHeldDamage()`, `getHeldItemMesh()`,
`getContainer(id)`, `depositToContainer(...)`, `withdrawFromContainer(...)`,
`saveNow()`, `getLandmarks()` and `getZoneAt(x, z)`. For save behaviour:
`advanceClockMs(ms)` pushes the world clock forward so a respawn timer can be
checked without waiting it out, and `depleteNode(id)` / `getNodeState(id)` work
a node without driving the mouse through a 35-second hold under software
rendering.

For loot and building: `getDroppedItems()`, `spawnDropAt(...)`,
`rollLootFor(enemyId)` (rolls a table without needing a kill, so a test can
average over hundreds of rolls), `killNearestEnemy()`, `getAllRecipes()`,
`getOccupiedCells()`, `getBuildRotation()`, `placeBuildingAt(...)`,
`demolishBuilding(id)` and `probeMoveTo(x, z, steps?)`.

For progression: `getRaidState()` now carries the raid number and the count
survived, `setRaidCount(n)` jumps the difficulty dial (playing ten raids to see
what raid ten looks like is twenty minutes of waiting per assertion),
`hurtPlayer(n)` runs the real damage path so a reduction under test is the one
the game applies.

For worn gear and the found tier: `getWorn()`, `wearItem(id)`,
`takeOffSlot(slot)`, `getWornDef(id)` (the table as data, so a suite reads the
game's numbers rather than restating them), `getDrawTime()`, `getCharmReach()`,
`getCleaveReach()`, `isFlying()`, `getFlightCeiling()`, `getHeightAboveGround()`
(the number the ceiling, the portal trigger and the pickup radius all actually
test against), `getWingsVisible()` (read off the mesh, so "on the character" is
a different question from "in the save"), plus `setPlayerYaw(yaw)` (the *body's* facing, which the
wide swing goes by — `setCameraYaw` moves the head and would leave the sweep
pointing elsewhere) and `attackOnce()`, one real swing down the same path the
left mouse button takes.

For levelling: `getLevel()` (level, exp, what the next one costs, unspent
points, where the spent ones went, and the resulting max health), `grantExp(n)`,
`allocateStat(id)`, `getEnemyExp(enemyId)`, `getArrowDamage()`,
`getGatherTimeFor(kind)`, `getMoveSpeedScale()` and `isAuraPlaying()`. Every one
of those reads the same function the game reads at its chokepoint, on purpose:
a suite that restated the arithmetic would pass against a build with the whole
of the wiring pulled out. `rollLootFor` passes Fortune's scale for the same
reason — it used to omit it, which made the hook a second implementation of
looting that happened to agree with the first, and a suite measuring drop rates
through it reported Fortune doing nothing while the game applied it correctly.

For gates, bows and traps: `toggleDoor(id)` / `getDoorState(id)`,
`shootArrow()` (the real firing path, draw cooldown and quiver check included)
and `getArrowsInFlight()`.

`getPortalSites()` lists every way out of the overworld — the three cave mouths
and the one tree — with where each puts you on the way back. Note that
`probeMoveTo` resolves against the **player's** collidable list: the two now
differ, and a probe run against the raiders' world would report the player
unable to walk onto something they can in fact walk onto.

For regions: `getRegion()` reports the active region's id, name, half-extent,
live node count and portals (each with its `armed` flag); `getCaveMouths()`
lists the ways down and where each one puts you on the way back;
`enterPortal(i)` teleports onto a portal and runs the ordinary per-frame
trigger, so a check exercises the real transition rather than a kinder one that
only tests have; and `setPortalArmed(i, armed)` drives the arming rule, which
the current layout otherwise makes unreachable — see the note in
`world/region.ts` about why it is kept anyway.

For raids: `getRaidState()`, `startRaid()` and `endRaid()` drive a raid without
waiting eighteen minutes for one; `spawnEnemyAt(enemyId, x, z)` puts one enemy
where you need it rather than wherever the spawn ring chose; and
`getBuildingHealth(id)`, `getRepairCost(id)`, `repairBuilding(id)` and
`enemyAttackAt(x, z, damage)` cover damage and repair. `enemyAttackAt` is the
real handler an enemy calls when something blocks it — destruction, spilled
barrels and all — not `BuildingSystem.damageBuilding` on its own, which knows
nothing about what was inside.

A third caution, and the one that invalidated the most: **a test cannot edit
the save by evaluating a change and then reloading.** The game persists on
`beforeunload`, so navigating away writes the live state straight back over the
edit, and the reload then loads a perfectly modern save. Every "an old save
still loads" check written that way was really checking that the current
session round-trips. `scratchpad/legacysave.mjs` parks on the same origin with
the game's scripts stubbed out so nothing can boot or re-save, edits there, and
only then goes back.

Two cautions learned the hard way, both about trusting an instrument:

- `isHeldItemVisible()` reports `onScreen` **and** a best-effort `firstHit`.
  Only `onScreen` is reliable — raycasting a `SkinnedMesh` uses its bind-pose
  bounds, so the ray slips past animated limbs and returns `no-ray-hit` for an
  item plainly on screen. An occlusion sweep built on it once "proved" the same
  3-of-12 result for every fist offset, including offsets a metre outside the
  body. Whether something reads correctly is settled by looking at a render.
- `getPlacedBuildings()` now includes the world's own POI barrels, so a bare
  `.length > 0` no longer proves *your* click placed anything. Filter by
  `buildingId`.
- `setCameraYaw(y)` takes effect on the *next* frame. Setting it and reading
  `getAimPoint()` in the same `evaluate` hands back the previous yaw's answer,
  which silently shifts a sweep by one entry and picks the wrong direction
  while looking entirely reasonable.
- An element's `hidden` property is not the last word on whether it is on
  screen: `.hud-raid` sets `display: flex`, which beats the browser's own
  `[hidden] { display: none }`. The raid banner sat on screen reading "Raid"
  from page load with nothing wrong in the JS, and it took a screenshot to
  notice. Ask `getComputedStyle(el).display` and the bounding box.
- Two whole features here — a wall's collision and a damaged wall's silhouette
  — are things a diff reads as correct and a render does not. The damage lean
  had to be measured against whether the crosshair could still find the piece,
  not judged by how good it looked in the code.
- **The game clock is not the wall clock.** Under swiftshader the loop runs at
  a couple of frames a second and dt is clamped at 0.1s, so game time advances
  roughly five times slower than real time. Anything measured on it — the bow's
  700ms draw, an attack cooldown, a respawn — is not cleared by
  `waitForTimeout`. `advanceClockMs` is the way to skip it; sleeping against it
  silently swallowed a shot and made "arrows never fly" the reported result.
- Picking an empty lane to walk means checking **everything `getCollidables`
  is built from**, which is the resource nodes *and* the placed buildings —
  including the world's own POI barrels. Scanning only the nodes chose a lane
  with a barrel in it and then blamed the spike trap for stopping the player.
- **A backfill guard on a whole object misses the field added to it later.**
  `state.raid` was filled in when the record was missing entirely, which is not
  the same as a save that has the record but predates `raid.count` — the easy
  half of that to get right is also the easy half to stop at.
- A piece's own geometry has to span the same axis the model it stands among
  does. The gate was built across x while the fence the walls use spans z, so
  it stood edge-on inside its own wall run and read as a single thin post —
  correct in every number, invisible as a gate.
