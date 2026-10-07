import type { NeedsYouItem, Snapshot } from '@ibitsa/protocol';
import { CampaignRecord } from './campaign-record';
import { Elder } from './elder';
import { Hero } from './hero';
import { NeedsYou } from './needs-you';
import { Outbox } from './outbox';
import { PullRequest } from './pull-request';
import { Quest } from './quest';
import { Review } from './review';
import { Sitting } from './sitting';
import type { CoreState } from './state.types';

/** The snapshot front ends see (spec §11.2.1). Read-only: anything a domain class emits here is discarded. */
export function view(state: CoreState): Snapshot {
  const outbox = new Outbox();
  const ctx = { state, outbox, needsYou: new NeedsYou({ state, outbox }), t: 0 };
  return {
    campaign: state.campaign && {
      id: state.campaign.id,
      title: state.campaign.title,
      status: state.campaign.status,
      autoApprove: state.campaign.autoApprove,
      branching: state.campaign.branching,
      stackedStart: state.campaign.stackedStart,
      capMicroUsd: state.settings.campaignBudgetMicroUsd,
      maxParallel: state.settings.maxParallel,
      shipped: PullRequest.shipped(state),
      ending: state.campaign.ending
        ? CampaignRecord.view({ ending: state.campaign.ending, state })
        : null,
      gold: CampaignRecord.gold(state),
    },
    elder: state.elder && Elder.view(state.elder),
    sitting: state.sitting && Sitting.view(state.sitting),
    islands: state.islands.map((i) => ({
      id: i.id,
      name: i.name,
      branch: i.branch,
      worktree: i.worktreeRemoved
        ? 'removed'
        : i.worktreePath
          ? 'ready'
          : i.launched
            ? 'creating'
            : 'waiting',
      basedOn: i.basedOn,
      behind: i.behind,
      taskPoints: i.taskPoints.map(({ id, title, state, review }) =>
        review ? { id, title, state, review: Review.view(review) } : { id, title, state },
      ),
      remote: i.remote
        ? { ...i.remote, pullRequest: i.remote.pullRequest && { ...i.remote.pullRequest } }
        : null,
      pullRequestDraft: PullRequest.draft({ state, island: i }),
    })),
    heroes: state.heroes.map((record) => new Hero({ record, ctx }).view()),
    needsYou: state.needsYou.map((item): NeedsYouItem => {
      if (item.kind !== 'permission' && item.kind !== 'question') return { ...item };
      const { requestId: _requestId, ...visible } = item;
      return visible;
    }),
  };
}
