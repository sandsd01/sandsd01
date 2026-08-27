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

## Controls

- `WASD` — move, mouse — look (click the canvas to lock the pointer)
- `E` — gather from the nearest tree/rock, or interact
- `F` — plant a selected seed into a farm plot / harvest a ready crop
- Left-click — attack the nearest enemy in range, or place a selected building
- `C` — crafting menu, `B` — building menu, `I` — inventory (select seeds here)
- `Q` — cancel building placement

## Scope (MVP)

Implemented: resource gathering (trees/rocks) + crafting, grid-based building
placement, crop farming (plant → grow → harvest), and enemy (zombie) combat
with a simple spawn/aggro/attack AI, plus save/load to `localStorage`.

Explicitly **out of scope** for this MVP (see
`/root/.claude/plans/romestead-memoized-charm.md` for the full plan/reasoning):

- Multiplayer/networking
- Infinite/streaming procedural terrain (this uses one fixed-size seeded
  heightmap instead)
- Multiple distinct biomes with terrain shaders, procedural dungeons
- Animal husbandry (crop farming only)
- Day/night cycle

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
browser console (`getPlayerPosition()`, `getInventory()`) for quick manual or
scripted (e.g. headless Playwright) checks.
