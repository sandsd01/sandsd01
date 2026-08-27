// Keyboard state + pointer-lock mouse-look, plus a simple "just pressed" queue
// for one-shot actions (interact, open panels) that systems can drain per frame.
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

  // Call once per frame after all systems have read input for this frame.
  endFrame(): void {
    this.justPressed.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }
}
