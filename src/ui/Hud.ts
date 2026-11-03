/**
 * Minimal heads-up display: stats, key hints, and a toast for changes.
 * Fades to near-invisible when idle so it never competes with the fluid.
 * (The full settings panel comes later.)
 */

const IDLE_AFTER_MS = 4000;

export class Hud {
  private readonly root = document.getElementById('hud')!;
  private readonly stats = document.getElementById('hud-stats')!;
  private readonly toastEl = document.getElementById('toast')!;
  private hidden = false;
  private lastActivity = performance.now();
  private frames = 0;
  private windowStart = performance.now();
  private toastTimer = 0;
  fps = 60;

  constructor() {
    const wake = () => {
      this.lastActivity = performance.now();
      this.root.classList.remove('idle');
    };
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('keydown', wake);
  }

  toggle(): void {
    this.hidden = !this.hidden;
    this.root.classList.toggle('hidden', this.hidden);
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1400);
  }

  /** Call once per frame. `describe` is only invoked when the stats refresh. */
  tick(now: number, describe: () => string): void {
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed >= 500) {
      this.fps = (this.frames * 1000) / elapsed;
      this.frames = 0;
      this.windowStart = now;
      this.stats.textContent = `${Math.round(this.fps)} fps · ${describe()}`;
    }
    if (now - this.lastActivity > IDLE_AFTER_MS) this.root.classList.add('idle');
  }
}
