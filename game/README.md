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
| UI type (Rubik, Cinzel) | [Fontsource](https://fontsource.org) | OFL-1.1 |
| HUD icons | [Lucide](https://lucide.dev) | ISC |

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
`main` deploys automatically**; a pull request gets its own preview URL. The
only non-default setting is the root directory, because this is one project
inside a repo whose root is the unrelated POS app:

| Setting | Value |
| --- | --- |
| Root Directory | `game` |
| Production Branch | `main` |
| Framework | Vite (auto-detected) |
| Build Command | `npm run build` (i.e. `tsc -b && vite build`) |
| Output Directory | `dist` |

`npm run build` type-checks before bundling, so a type error fails the deploy
rather than shipping a broken build. Nothing here reads an environment
variable — the game is fully client-side and persists to `localStorage` — so
there is no deploy-time configuration to keep in sync.

## Controls

- `WASD` — move, `Shift` — sprint, `Space` — jump, mouse — look
- `E` — gather from the nearest tree/rock, or interact
- `F` — plant a selected seed into a farm plot / harvest a ready crop
- Left-click — attack the nearest enemy in range, or place a selected building
- `1`–`4` — pick a build piece straight from the hotbar (press again to cancel)
- `Q` — cancel building placement
- `C` — crafting, `B` — building menu, `Tab` or `I` — inventory (select seeds here)
- `Esc` — close the open menu, or open Options when nothing is open

Scroll to zoom. Click the canvas to lock the pointer for mouse-look.

These follow the conventions of the genre rather than inventing new ones, so
the bindings a player arrives with mostly work: `Space` jumps, `Esc` backs out
of menus and doubles as the options screen, `Tab` and `I` both open the
inventory (the genre is split between them), only one menu is open at a time,
and movement stops while one is. Options covers the two settings every game
here ships — look sensitivity and invert-Y — stored separately from the save
so they survive starting a new world.

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
