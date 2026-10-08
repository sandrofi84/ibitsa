import type { ActivityKind } from '@ibitsa/protocol';
import type { TestDetector } from '@ibitsa/runtime';
import type { AgentPrices } from './acp-adapter.types';

export interface Activity {
  kind: ActivityKind;
  detail?: string;
}

export interface UpdateMapperInit {
  /** The hero's worktree: paths inside it are shown relative. */
  cwd: string;
  tests: TestDetector;
  prices?: AgentPrices;
}
