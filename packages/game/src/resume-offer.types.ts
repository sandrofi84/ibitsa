import type { HeroClassView, HeroView, ResumeOfferView } from '@ibitsa/protocol';

/** What the resume dialog is drawn from: the offer and the heroes and classes it names. */
export interface ResumeOfferInput {
  offer: ResumeOfferView;
  heroes: readonly HeroView[];
  classes: readonly HeroClassView[];
}

/** One line of the resume dialog: who would resume, since when, and about what it costs. */
export interface ResumeItem {
  /** A hero's id, or `COUNCIL_RESUME`. */
  id: string;
  label: string;
  detail: string;
}

/** The resume dialog in words (#293). */
export interface ResumeOfferModel {
  items: ResumeItem[];
}
