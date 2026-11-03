/**
 * Mouse, touch and pen through Pointer Events, with multi-touch.
 *
 * Mouse hover stirs the fluid; pressing paints. Touch and pen act only while
 * down. Each frame, every pointer that moved reports the segment it travelled,
 * so strokes stay continuous however fast the hand moves.
 */

import type { Vec2 } from '../sim/FluidSolver';

export interface TrackedPointer {
  readonly id: number;
  readonly type: string;
  /** Current position in uv (0..1, y up). */
  x: number;
  y: number;
  /** Position when the last stroke was consumed. */
  lastX: number;
  lastY: number;
  down: boolean;
  /** Position along the colour palette; drifts as the pointer paints. */
  phase: number;
}

export class PointerInput {
  readonly pointers = new Map<number, TrackedPointer>();
  /** Called when a pointer goes down. */
  onPress?: (pointer: TrackedPointer) => void;
  private nextPhase = Math.random();

  constructor(
    private readonly element: HTMLElement,
    private readonly hover = true,
  ) {
    element.addEventListener('pointerdown', this.handleDown);
    element.addEventListener('pointermove', this.handleMove);
    element.addEventListener('pointerup', this.handleUp);
    element.addEventListener('pointercancel', this.handleUp);
    element.addEventListener('pointerleave', this.handleLeave);
  }

  /** Calls `fn` for every pointer that moved since the last call. */
  forEachStroke(fn: (pointer: TrackedPointer, from: Vec2, to: Vec2) => void): void {
    for (const p of this.pointers.values()) {
      if (p.x === p.lastX && p.y === p.lastY) continue;
      fn(p, [p.lastX, p.lastY], [p.x, p.y]);
      p.lastX = p.x;
      p.lastY = p.y;
    }
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.handleDown);
    this.element.removeEventListener('pointermove', this.handleMove);
    this.element.removeEventListener('pointerup', this.handleUp);
    this.element.removeEventListener('pointercancel', this.handleUp);
    this.element.removeEventListener('pointerleave', this.handleLeave);
  }

  private toUv(e: PointerEvent): Vec2 {
    const rect = this.element.getBoundingClientRect();
    return [(e.clientX - rect.left) / rect.width, 1 - (e.clientY - rect.top) / rect.height];
  }

  private track(e: PointerEvent): TrackedPointer {
    const [x, y] = this.toUv(e);
    // Golden-ratio steps spread successive pointers evenly around the palette.
    this.nextPhase = (this.nextPhase + 0.618034) % 1;
    const pointer: TrackedPointer = {
      id: e.pointerId, type: e.pointerType, x, y, lastX: x, lastY: y, down: false, phase: this.nextPhase,
    };
    this.pointers.set(e.pointerId, pointer);
    return pointer;
  }

  private readonly handleDown = (e: PointerEvent) => {
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for synthetic events; tracking still works without it.
    }
    const pointer = this.pointers.get(e.pointerId) ?? this.track(e);
    const [x, y] = this.toUv(e);
    pointer.x = x;
    pointer.y = y;
    pointer.down = true;
    this.onPress?.(pointer);
  };

  private readonly handleMove = (e: PointerEvent) => {
    const hovering = this.hover && e.pointerType === 'mouse';
    let pointer = this.pointers.get(e.pointerId);
    if (!pointer) {
      if (!hovering) return;
      pointer = this.track(e);
    }
    if (!pointer.down && !hovering) return;
    const [x, y] = this.toUv(e);
    pointer.x = x;
    pointer.y = y;
  };

  private readonly handleUp = (e: PointerEvent) => {
    const pointer = this.pointers.get(e.pointerId);
    if (!pointer) return;
    pointer.down = false;
    if (e.pointerType !== 'mouse') this.pointers.delete(e.pointerId);
  };

  private readonly handleLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') this.pointers.delete(e.pointerId);
  };
}
