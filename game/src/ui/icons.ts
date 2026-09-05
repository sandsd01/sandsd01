// Icons are inlined from lucide-static (ISC) at build time via Vite's ?raw
// import, so only the handful used here reaches the bundle rather than the
// whole set. Every lucide glyph draws with stroke="currentColor", which is why
// a chip can tint its icon by setting `color` and nothing else.
import anvil from "lucide-static/icons/anvil.svg?raw";
import axe from "lucide-static/icons/axe.svg?raw";
import bicepsFlexed from "lucide-static/icons/biceps-flexed.svg?raw";
import bone from "lucide-static/icons/bone.svg?raw";
import brickWall from "lucide-static/icons/brick-wall.svg?raw";
import chevronsUp from "lucide-static/icons/chevrons-up.svg?raw";
import cloud from "lucide-static/icons/cloud.svg?raw";
import clover from "lucide-static/icons/clover.svg?raw";
import crosshair from "lucide-static/icons/crosshair.svg?raw";
import feather from "lucide-static/icons/feather.svg?raw";
import fence from "lucide-static/icons/fence.svg?raw";
import flame from "lucide-static/icons/flame.svg?raw";
import footprints from "lucide-static/icons/footprints.svg?raw";
import hammer from "lucide-static/icons/hammer.svg?raw";
import gem from "lucide-static/icons/gem.svg?raw";
import grape from "lucide-static/icons/grape.svg?raw";
import heart from "lucide-static/icons/heart.svg?raw";
import landmark from "lucide-static/icons/landmark.svg?raw";
import layers from "lucide-static/icons/layers.svg?raw";
import moon from "lucide-static/icons/moon.svg?raw";
import mountain from "lucide-static/icons/mountain.svg?raw";
import navigation from "lucide-static/icons/navigation.svg?raw";
import orbit from "lucide-static/icons/orbit.svg?raw";
import pickaxe from "lucide-static/icons/pickaxe.svg?raw";
import shield from "lucide-static/icons/shield.svg?raw";
import shirt from "lucide-static/icons/shirt.svg?raw";
import shovel from "lucide-static/icons/shovel.svg?raw";
import sparkles from "lucide-static/icons/sparkles.svg?raw";
import sprout from "lucide-static/icons/sprout.svg?raw";
import squareStack from "lucide-static/icons/square-stack.svg?raw";
import sun from "lucide-static/icons/sun.svg?raw";
import sunrise from "lucide-static/icons/sunrise.svg?raw";
import sword from "lucide-static/icons/sword.svg?raw";
import swords from "lucide-static/icons/swords.svg?raw";
import trees from "lucide-static/icons/trees.svg?raw";
import wind from "lucide-static/icons/wind.svg?raw";
import wheat from "lucide-static/icons/wheat.svg?raw";

const SOURCES = {
  anvil,
  axe,
  bicepsFlexed,
  chevronsUp,
  bone,
  brickWall,
  cloud,
  clover,
  crosshair,
  feather,
  fence,
  flame,
  footprints,
  gem,
  hammer,
  grape,
  landmark,
  heart,
  layers,
  moon,
  mountain,
  navigation,
  orbit,
  pickaxe,
  shield,
  shirt,
  shovel,
  sparkles,
  sprout,
  squareStack,
  sun,
  sunrise,
  sword,
  swords,
  trees,
  wheat,
  wind,
} as const;

export type IconName = keyof typeof SOURCES;

// Raw markup, for callers that need to swap an icon in place rather than
// build a fresh element (the clock re-renders every frame).
export function iconSvg(name: IconName): string {
  return SOURCES[name];
}

// Every icon ships at 24x24; the wrapper sizes it with CSS so callers never
// have to think in pixels.
export function icon(name: IconName, className = "icon"): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.innerHTML = SOURCES[name];
  span.setAttribute("aria-hidden", "true");
  return span;
}
