// Keyboard state + pointer-lock mouse-look, plus a simple "just pressed" queue
// for one-shot actions (interact, open panels) that systems can drain per
// frame. Also the single input source on touch devices: ui/touch-controls.ts
// feeds this class through setMoveVector/addLookDelta/simulateKeyPress rather
// than owning any input state of its own, so the rest of the game (player
// controller, main loop) never needs to know whether input came from a
// keyboard/mouse or an on-screen joystick/buttons.
export class InputManager {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  private pointerLocked = false;
  private moveOverride: { x: number; y: number } | null = null;
  mouseDeltaX = 0;
  mouseDeltaY = 0;
  readonly isTouchDevice: boolean;

  constructor(canvas: HTMLCanvasElement) {
    this.isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

    window.addEventListener("keydown", (e) => {
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });

    // Pointer Lock has no meaning on touch (no cursor to lock/hide), and
    // requesting it on tap can misbehave on mobile browsers — touch input is
    // handled entirely by TouchControls instead.
    if (!this.isTouchDevice) {
      canvas.addEventListener("click", () => {
        if (!this.pointerLocked) canvas.requestPointerLock();
      });

      document.addEventListener("pointerlockchange", () => {
        this.pointerLocked = document.pointerLockElement === canvas;
      });

      document.addEventListener("mousemove", (e) => {
        if (!this.pointerLocked) return;
        this.mouseDeltaX += e.movementX;
        this.mouseDeltaY += e.movementY;
      });
    }
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  wasJustPressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  // True once the player has a working way to look around/act: real pointer
  // lock on desktop, or unconditionally on touch (the on-screen controls are
  // always "active", there's no lock/unlock state on mobile).
  isControlsActive(): boolean {
    return this.pointerLocked || this.isTouchDevice;
  }

  // --- touch-controls support (see ui/touch-controls.ts) ---

  setMoveVector(x: number, y: number): void {
    this.moveOverride = { x, y };
  }

  clearMoveVector(): void {
    this.moveOverride = null;
  }

  addLookDelta(dx: number, dy: number): void {
    this.mouseDeltaX += dx;
    this.mouseDeltaY += dy;
  }

  simulateKeyPress(code: string): void {
    this.justPressed.add(code);
  }

  // Movement as a normalized-ish 2D vector (x = strafe, y = forward/back) in
  // roughly [-1, 1] per axis — from the touch joystick if one is active,
  // otherwise derived from WASD key state.
  getMoveVector(): { x: number; y: number } {
    if (this.moveOverride) return this.moveOverride;
    let x = 0;
    let y = 0;
    if (this.isDown("KeyW")) y += 1;
    if (this.isDown("KeyS")) y -= 1;
    if (this.isDown("KeyD")) x += 1;
    if (this.isDown("KeyA")) x -= 1;
    return { x, y };
  }

  // Call once per frame after all systems have read input for this frame.
  endFrame(): void {
    this.justPressed.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }
}
