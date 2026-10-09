import type { HutDoorInput, HutPlace, LeftHut } from './hut-door.types';
import { isSitting } from './sitting-hut';

/**
 * Whether the hut shows, and for what (#244, #245). With no campaign running it shows only once the
 * user walks in for the elder's welcome. While a campaign plans it shows by itself: the elder alone
 * while it researches and offers its brief, the council while it sits. Leaving by the door neither
 * pauses nor ends anything, as with Later: the work goes on, what needs the user waits in Needs you,
 * and clicking the hut goes back in. A new sitting shows the hut again.
 */
export class HutDoor {
  /** The user walked in with no campaign planning: the elder welcomes them. */
  private welcoming = false;
  private left: LeftHut | null = null;

  /** What the hut shows for this snapshot. */
  see(snapshot: HutDoorInput): HutPlace {
    const campaign = snapshot?.campaign;
    // The welcome ends once it has started a campaign (the elder's research, or a quick quest).
    if (campaign?.status === 'planning' || campaign?.status === 'active') this.welcoming = false;
    if (campaign?.status !== 'planning') return this.welcoming ? 'elder' : null;
    const left = this.left?.campaignId === campaign.id ? this.left : null;
    const sitting = snapshot?.sitting;
    if (isSitting(sitting)) return left?.sittingId === sitting.id ? null : 'sitting';
    // The elder has something to offer: its research, its brief, or the council's approved plan. A
    // council convened without it and dismissed leaves nothing in the hut.
    const offers = snapshot?.elder != null || snapshot?.sitting?.status === 'approved';
    return left || !offers ? null : 'elder';
  }

  /** The user clicked the hut, or a Needs you item that's answered there. */
  enter(): void {
    this.left = null;
    this.welcoming = true;
  }

  /** The welcome's form was cancelled: with no campaign, back to the map. */
  endWelcome(): void {
    this.welcoming = false;
  }

  /** The user left by the door: the hut stays shut until they come back or a new sitting starts. */
  leave(snapshot: HutDoorInput): void {
    this.welcoming = false;
    const campaign = snapshot?.campaign;
    const sitting = snapshot?.sitting;
    this.left =
      campaign?.status === 'planning'
        ? { campaignId: campaign.id, sittingId: isSitting(sitting) ? sitting.id : null }
        : null;
  }
}
