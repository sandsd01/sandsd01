import type { Action, Bindings } from "../state/keybindings";

// Keyboard state + pointer-lock mouse-look, plus a simple "just pressed" queue
// for one-shot actions (interact, open panels) that systems can drain per
// frame. PC-only: mouse-look requires the Pointer Lock API, which has no
// touch equivalent, so this game targets desktop keyboard/mouse.
export class InputManager {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  private pointerLocked = false;
  // Mouse buttons are held state, not just events: the primary action repeats
  // while the button is down (hold to chop, hold to swing).
  private mouseDown = new Set<number>();
  private mouseJustPressed = new Set<number>();
  private wheelDelta = 0;
  private wheelWithCtrl = false;
  mouseDeltaX = 0;
  mouseDeltaY = 0;

  // While the Options screen is listening for a new binding, keystrokes go to
  // it instead of the game — otherwise binding "jump" to W would also walk the
  // player forward on the way past.
  private captureHandler: ((code: string) => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private bindings: Bindings,
  ) {
    window.addEventListener("keydown", (e) => {
      // Tab would walk focus off the canvas and Space scrolls the page in some
      // browsers; both are bound to gameplay, so neither should do its default.
      if (e.code === "Tab" || e.code === "Space") e.preventDefault();
      if (this.captureHandler) {
        e.preventDefault();
        const handler = this.captureHandler;
        this.captureHandler = null;
        handler(e.code);
        return;
      }
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });

    canvas.addEventListener("click", () => {
      if (!this.pointerLocked) canvas.requestPointerLock();
    });

    canvas.addEventListener("mousedown", (e) => {
      // A click that only acquires pointer lock must not also swing: the
      // player is asking for control of the mouse, not for an action.
      if (!this.pointerLocked) return;
      if (!this.mouseDown.has(e.button)) this.mouseJustPressed.add(e.button);
      this.mouseDown.add(e.button);
    });
    window.addEventListener("mouseup", (e) => {
      this.mouseDown.delete(e.button);
    });
    // Right-click is the place/use button; the browser menu would eat it.
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // The wheel is routed by main.ts: bare scroll cycles the build hotbar
    // (as in Minecraft), Ctrl+scroll zooms the camera.
    window.addEventListener(
      "wheel",
      (e) => {
        this.wheelDelta += e.deltaY;
        this.wheelWithCtrl = e.ctrlKey;
      },
      { passive: true },
    );

    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      // Losing the lock (Escape, alt-tab) delivers no mouseup, so a held
      // button would stay down and keep acting behind an open menu.
      if (!this.pointerLocked) this.mouseDown.clear();
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

  // Gameplay asks by action, never by key code, so rebinding needs no changes
  // anywhere else.
  isActionDown(action: Action): boolean {
    return this.bindings[action].some((code) => this.keys.has(code));
  }

  wasActionPressed(action: Action): boolean {
    return this.bindings[action].some((code) => this.justPressed.has(code));
  }

  // Called after a rebind so the change takes effect without a reload.
  setBindings(bindings: Bindings): void {
    this.bindings = bindings;
  }

  captureNextKey(handler: (code: string) => void): void {
    this.captureHandler = handler;
  }

  cancelCapture(): void {
    this.captureHandler = null;
  }

  isCapturing(): boolean {
    return this.captureHandler !== null;
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  isMouseDown(button: number): boolean {
    return this.mouseDown.has(button);
  }

  wasMousePressed(button: number): boolean {
    return this.mouseJustPressed.has(button);
  }

  /** Consumes the wheel movement accumulated since the last frame. */
  takeWheel(): { delta: number; withCtrl: boolean } {
    const result = { delta: this.wheelDelta, withCtrl: this.wheelWithCtrl };
    this.wheelDelta = 0;
    this.wheelWithCtrl = false;
    return result;
  }

  // Movement as a 2D vector (x = strafe, y = forward/back) in [-1, 1] per
  // axis, derived from WASD key state.
  getMoveVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.isActionDown("moveForward")) y += 1;
    if (this.isActionDown("moveBack")) y -= 1;
    if (this.isActionDown("moveRight")) x += 1;
    if (this.isActionDown("moveLeft")) x -= 1;
    return { x, y };
  }

  isSprinting(): boolean {
    return this.isActionDown("sprint");
  }

  // Call once per frame after all systems have read input for this frame.
  endFrame(): void {
    this.justPressed.clear();
    this.mouseJustPressed.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }
}
