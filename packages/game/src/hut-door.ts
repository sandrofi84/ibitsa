import type { HutDoorInput, HutPlace } from './hut-door.types';
import { isSitting } from './sitting-hut';

/**
 * Whether the hut shows (#245): it does by itself while the council sits, until the user leaves by its
 * door. Leaving neither pauses nor ends the sitting, as with Later: the council keeps working, its
 * questions wait in Needs you, and clicking the hut goes back in. A new sitting shows the hut again.
 */
export class HutDoor {
  /** The sitting the user walked out of. */
  private left: string | null = null;

  /** What the hut shows for this snapshot. */
  see(snapshot: HutDoorInput): HutPlace {
    const sitting = snapshot?.sitting;
    if (!isSitting(sitting)) return null;
    return sitting.id === this.left ? null : 'sitting';
  }

  /** The user clicked the hut, or a Needs you item that's answered there. */
  enter(): void {
    this.left = null;
  }

  /** The user left by the door: the hut stays shut until they come back or a new sitting starts. */
  leave(snapshot: HutDoorInput): void {
    const sitting = snapshot?.sitting;
    this.left = isSitting(sitting) ? sitting.id : null;
  }
}
