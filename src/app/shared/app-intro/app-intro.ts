import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, signal } from '@angular/core';

type IntroState = 'idle' | 'dragging' | 'committing' | 'returning' | 'completed';
type DragDirection = -1 | 1;

const SLICE_RATIOS = [1, 0.88, 1.08, 0.92, 1.04] as const;
const SLICE_TRAVEL = 120;
const MIN_COMPLETION_DISTANCE = 240;
const MAX_COMPLETION_DISTANCE = 360;

@Component({
  selector: 'app-intro',
  styleUrl: './app-intro.css',
  templateUrl: './app-intro.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppIntroComponent {
  @Output() readonly completed = new EventEmitter<void>();

  readonly state = signal<IntroState>('idle');
  readonly dragProgress = signal(0);
  readonly dragDirection = signal<DragDirection>(-1);
  readonly isDragging = computed(() => this.state() === 'dragging');
  readonly isSettling = computed(() => {
    const currentState = this.state();
    return currentState === 'committing' || currentState === 'returning';
  });
  readonly slices = [0, 1, 2, 3, 4] as const;

  readonly landscapeImageUrl = '/assets/images/entrance-landscape.png';

  private activePointerId: number | null = null;
  private dragStartY = 0;
  private completionDistance = MIN_COMPLETION_DISTANCE;

  onPointerDown(event: PointerEvent) {
    if (
      this.state() !== 'idle' ||
      !event.isPrimary ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return;
    }

    const dragSurface = event.currentTarget as HTMLElement;
    this.activePointerId = event.pointerId;
    this.dragStartY = event.clientY;
    this.completionDistance = this.getCompletionDistance();
    this.dragProgress.set(0);
    this.state.set('dragging');
    dragSurface.setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent) {
    if (!this.isActivePointer(event)) {
      return;
    }

    const deltaY = event.clientY - this.dragStartY;
    const progress = this.clamp(Math.abs(deltaY) / this.completionDistance);

    if (deltaY !== 0) {
      this.dragDirection.set(deltaY < 0 ? -1 : 1);
    }

    this.dragProgress.set(progress);
  }

  onPointerUp(event: PointerEvent) {
    if (!this.isActivePointer(event)) {
      return;
    }

    this.releasePointer(event);
    this.settleTo(this.dragProgress() >= 1 ? 'committing' : 'returning');
  }

  onPointerCancel(event: PointerEvent) {
    if (!this.isActivePointer(event)) {
      return;
    }

    this.releasePointer(event);
    this.settleTo('returning');
  }

  onSliceTransitionEnd(event: TransitionEvent, sliceIndex: number) {
    if (sliceIndex !== this.slices.length - 1 || event.propertyName !== 'transform') {
      return;
    }

    if (this.state() === 'committing') {
      this.state.set('completed');
      this.completed.emit();
      return;
    }

    if (this.state() === 'returning') {
      this.dragDirection.set(-1);
      this.state.set('idle');
    }
  }

  skipIntro() {
    this.state.set('completed');
    this.completed.emit();
  }

  sliceTransform(sliceIndex: number): string {
    const alternatingDirection = sliceIndex % 2 === 0 ? 1 : -1;
    const distance =
      this.dragDirection() * alternatingDirection * SLICE_RATIOS[sliceIndex] * SLICE_TRAVEL * this.dragProgress();

    return `translate3d(0, ${distance}dvh, 0)`;
  }

  landscapeOffset(sliceIndex: number): string {
    return `${sliceIndex * -100}%`;
  }

  brandOpacity(): number {
    return 1 - Math.pow(this.dragProgress(), 1.7);
  }

  brandTransform(): string {
    return `translate3d(0, ${this.dragProgress() * -6}px, 0)`;
  }

  private getCompletionDistance(): number {
    return Math.min(Math.max(window.innerHeight * 0.32, MIN_COMPLETION_DISTANCE), MAX_COMPLETION_DISTANCE);
  }

  private settleTo(nextState: 'committing' | 'returning') {
    const targetProgress = nextState === 'committing' ? 1 : 0;
    const isAtTarget = this.dragProgress() === targetProgress;

    this.state.set(nextState);

    if (isAtTarget) {
      requestAnimationFrame(() => this.completeSettlement(nextState));
      return;
    }

    requestAnimationFrame(() => {
      if (this.state() === nextState) {
        this.dragProgress.set(targetProgress);
      }
    });
  }

  private completeSettlement(nextState: 'committing' | 'returning') {
    if (this.state() !== nextState) {
      return;
    }

    if (nextState === 'committing') {
      this.state.set('completed');
      this.completed.emit();
      return;
    }

    this.dragDirection.set(-1);
    this.state.set('idle');
  }

  private isActivePointer(event: PointerEvent): boolean {
    return this.state() === 'dragging' && this.activePointerId === event.pointerId;
  }

  private releasePointer(event: PointerEvent) {
    const dragSurface = event.currentTarget as HTMLElement;

    if (dragSurface.hasPointerCapture(event.pointerId)) {
      dragSurface.releasePointerCapture(event.pointerId);
    }

    this.activePointerId = null;
  }

  private clamp(value: number): number {
    return Math.min(Math.max(value, 0), 1);
  }
}
