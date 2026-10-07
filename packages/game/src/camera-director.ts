import type { HeroView, Snapshot } from '@ibitsa/protocol';
import type { CameraAim } from './camera-director.types';

export const OVERVIEW_ZOOM = 1;
export const FOCUS_ZOOM = 2;
export const MAX_ZOOM = 3;

/**
 * Decides where the camera looks (#59), without Phaser so it can be tested. While a hero works the camera
 * focuses on it. Once you zoom or pan yourself, it stays where you put it until something needs you or
 * the hero arrives somewhere new; then, with auto-focus on, it focuses again.
 */
export class CameraDirector {
  private aim: CameraAim = { zoom: OVERVIEW_ZOOM, follow: false };
  private userTookOver = false;
  private auto: boolean;
  private previousState: string | null = null;
  private seenItems = new Set<string>();
  private focused: string | null = null;

  constructor({ auto }: { auto: boolean }) {
    this.auto = auto;
  }

  get current(): CameraAim {
    return this.aim;
  }

  get autoFocus(): boolean {
    return this.auto;
  }

  /**
   * The hero the camera follows (#124): the selected one, else the first one working, else the first.
   * The hero pane's selection (#125) sets `selected`.
   */
  static focusOf(snapshot: Snapshot, selected: string | null): HeroView | undefined {
    return (
      snapshot.heroes.find((h) => h.id === selected) ??
      snapshot.heroes.find((h) => h.state.kind === 'working') ??
      snapshot.heroes[0]
    );
  }

  /** Reacts to a snapshot; returns true when the aim changed. */
  observe(snapshot: Snapshot, selected: string | null = null): boolean {
    const hero = CameraDirector.focusOf(snapshot, selected);
    if (hero?.id !== this.focused) {
      // A different hero to follow: what the last one was doing says nothing about this one.
      this.focused = hero?.id ?? null;
      this.previousState = null;
    }
    const before = this.aim;
    if (!hero || snapshot.campaign?.status !== 'active') {
      this.userTookOver = false;
      this.previousState = null;
      this.seenItems = new Set(snapshot.needsYou.map((i) => i.id));
      this.aim = { zoom: OVERVIEW_ZOOM, follow: false };
      return changed(before, this.aim);
    }
    const state = hero.state.kind;
    const arrived = this.previousState === 'traveling' && state !== 'traveling';
    const startedWorking = this.previousState !== 'working' && state === 'working';
    const newItem = snapshot.needsYou.some((i) => !this.seenItems.has(i.id));
    this.previousState = state;
    this.seenItems = new Set(snapshot.needsYou.map((i) => i.id));

    // Something new to see overrides your own camera; merely starting work doesn't.
    if (arrived || newItem) this.userTookOver = false;
    if (this.auto && !this.userTookOver && (arrived || newItem || startedWorking)) {
      this.aim = { zoom: Math.max(this.aim.zoom, FOCUS_ZOOM), follow: true };
    }
    return changed(before, this.aim);
  }

  zoomIn(): CameraAim {
    this.userTookOver = true;
    this.aim = { zoom: Math.min(MAX_ZOOM, this.aim.zoom + 1), follow: true };
    return this.aim;
  }

  zoomOut(): CameraAim {
    this.userTookOver = true;
    const zoom = Math.max(OVERVIEW_ZOOM, this.aim.zoom - 1);
    this.aim = { zoom, follow: zoom > OVERVIEW_ZOOM && this.aim.follow };
    return this.aim;
  }

  overview(): CameraAim {
    this.userTookOver = true;
    this.aim = { zoom: OVERVIEW_ZOOM, follow: false };
    return this.aim;
  }

  /** You dragged the map: stop following, keep the zoom. */
  pan(): CameraAim {
    this.userTookOver = true;
    this.aim = { ...this.aim, follow: false };
    return this.aim;
  }

  setAuto(auto: boolean): void {
    this.auto = auto;
  }
}

function changed(a: CameraAim, b: CameraAim): boolean {
  return a.zoom !== b.zoom || a.follow !== b.follow;
}
