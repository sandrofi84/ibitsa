/** The Guild Hall's Armory tab (#182), drawn inside the Guild Hall's panel. */
export interface ArmoryTab {
  /** Asks the host for the classes and recolors; the tab redraws when they arrive. */
  load(): void;
  /** The tab's content, for the Guild Hall's panel. */
  render(): HTMLElement[];
}
