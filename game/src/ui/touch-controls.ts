import type { InputManager } from "../input/input-manager";
import { el } from "./dom";

const JOYSTICK_RADIUS = 50;
const LOOK_SENSITIVITY_SCALE = 2.2;

// On-screen touch controls for mobile: a virtual joystick for movement, a
// full-screen drag zone for camera look, and a cluster of buttons for the
// actions keyboard/mouse would otherwise handle (gather, plant/harvest,
// attack/place, and opening the crafting/building/inventory panels).
// Everything here just calls back into InputManager/callbacks — it owns no
// gameplay state of its own.
export class TouchControls {
  constructor(
    root: HTMLElement,
    private readonly input: InputManager,
    private readonly onPrimaryAction: () => void,
    private readonly onOpenCraft: () => void,
    private readonly onOpenBuild: () => void,
    private readonly onOpenInventory: () => void,
  ) {
    // Look zone first so it sits behind the joystick/buttons in stacking
    // order — a touch that starts on a button/joystick is targeted at that
    // element instead, so it never also triggers a look-drag.
    this.buildLookZone(root);
    this.buildJoystick(root);
    this.buildActionButtons(root);
  }

  private buildLookZone(root: HTMLElement): void {
    const zone = el("div", "touch-look-zone");
    root.appendChild(zone);

    const active = new Map<number, { x: number; y: number }>();

    zone.addEventListener("pointerdown", (e) => {
      zone.setPointerCapture(e.pointerId);
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    zone.addEventListener("pointermove", (e) => {
      const prev = active.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.input.addLookDelta(dx * LOOK_SENSITIVITY_SCALE, dy * LOOK_SENSITIVITY_SCALE);
    });
    const end = (e: PointerEvent) => active.delete(e.pointerId);
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
  }

  private buildJoystick(root: HTMLElement): void {
    const base = el("div", "touch-joystick-base");
    const knob = el("div", "touch-joystick-knob");
    base.appendChild(knob);
    root.appendChild(base);

    let activePointerId: number | null = null;

    const handleMove = (e: PointerEvent) => {
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > JOYSTICK_RADIUS) {
        dx = (dx / dist) * JOYSTICK_RADIUS;
        dy = (dy / dist) * JOYSTICK_RADIUS;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // Screen Y grows downward; "forward" (joystick pushed up) should be
      // positive, so negate dy.
      this.input.setMoveVector(dx / JOYSTICK_RADIUS, -dy / JOYSTICK_RADIUS);
    };

    base.addEventListener("pointerdown", (e) => {
      activePointerId = e.pointerId;
      base.setPointerCapture(e.pointerId);
      handleMove(e);
    });
    base.addEventListener("pointermove", (e) => {
      if (e.pointerId !== activePointerId) return;
      handleMove(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      knob.style.transform = "translate(0, 0)";
      this.input.clearMoveVector();
    };
    base.addEventListener("pointerup", end);
    base.addEventListener("pointercancel", end);
  }

  private buildActionButtons(root: HTMLElement): void {
    const cluster = el("div", "touch-actions");
    const interact = el("button", "touch-btn touch-btn-interact", "✋");
    interact.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.input.simulateKeyPress("KeyE");
    });
    const plant = el("button", "touch-btn touch-btn-plant", "🌱");
    plant.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.input.simulateKeyPress("KeyF");
    });
    const primary = el("button", "touch-btn touch-btn-primary", "⚔");
    primary.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.onPrimaryAction();
    });
    cluster.append(interact, plant, primary);
    root.appendChild(cluster);

    const menu = el("div", "touch-menu");
    const craftBtn = el("button", "touch-btn touch-btn-small", "🔨");
    craftBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.onOpenCraft();
    });
    const buildBtn = el("button", "touch-btn touch-btn-small", "🏠");
    buildBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.onOpenBuild();
    });
    const invBtn = el("button", "touch-btn touch-btn-small", "🎒");
    invBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.onOpenInventory();
    });
    const cancelBtn = el("button", "touch-btn touch-btn-small", "✕");
    cancelBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.input.simulateKeyPress("KeyQ");
    });
    menu.append(craftBtn, buildBtn, invBtn, cancelBtn);
    root.appendChild(menu);
  }
}
