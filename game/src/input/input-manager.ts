// Keyboard state + pointer-lock mouse-look, plus a simple "just pressed" queue
// for one-shot actions (interact, open panels) that systems can drain per
// frame. PC-only: mouse-look requires the Pointer Lock API, which has no
// touch equivalent, so this game targets desktop keyboard/mouse.
export class InputManager {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  private pointerLocked = false;
  mouseDeltaX = 0;
  mouseDeltaY = 0;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });

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

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  wasJustPressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  // Movement as a 2D vector (x = strafe, y = forward/back) in [-1, 1] per
  // axis, derived from WASD key state.
  getMoveVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.isDown("KeyW")) y += 1;
    if (this.isDown("KeyS")) y -= 1;
    if (this.isDown("KeyD")) x += 1;
    if (this.isDown("KeyA")) x -= 1;
    return { x, y };
  }

  isSprinting(): boolean {
    return this.isDown("ShiftLeft") || this.isDown("ShiftRight");
  }

  // Call once per frame after all systems have read input for this frame.
  endFrame(): void {
    this.justPressed.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }
}
