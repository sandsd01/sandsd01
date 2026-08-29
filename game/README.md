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
- **Left mouse (hold)** — chop/mine whatever the crosshair is on, or swing at it
- **Right mouse** — place the selected build piece, or plant/harvest the aimed plot
- Scroll — cycle the build hotbar, `Ctrl`+scroll — zoom the camera
- `F5` or `V` — switch between third and first person
- `E` — gather what you're aiming at, falling back to the nearest node in range
- `F` — plant a selected seed into a farm plot / harvest a ready crop
- `1`–`8` — pick a build piece straight from the hotbar (press again to cancel)
- `Q` — cancel building placement
- `C` — crafting, `B` — building menu, `Tab` or `I` — inventory (select seeds here)
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

The build hotbar is always on screen and greys out pieces you can't yet
afford, so building normally needs no menu at all — the `B` panel is only
there when you want the full costs written out.

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
