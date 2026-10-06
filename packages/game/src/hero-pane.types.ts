/** What the rest of the game can do with the hero pane. */
export interface HeroPane {
  /** Expands the pane and moves keyboard focus to it, e.g. when the hero is clicked on the map. */
  open(): void;
  /** The pane itself, so the camera can keep the hero clear of it. */
  readonly element: HTMLElement;
}
