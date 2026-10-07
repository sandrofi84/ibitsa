/** The Guild Hall's Roster tab (#181): the panel asks it for fresh settings and its content. */
export interface RosterTab {
  /** Asks the host for the council settings; the tab re-renders through `onChange` when they come. */
  refresh(): void;
  render(): HTMLElement[];
}

/** A new councillor as the form holds it. */
export interface NewCouncillorDraft {
  id: string;
  title: string;
  description: string;
}
