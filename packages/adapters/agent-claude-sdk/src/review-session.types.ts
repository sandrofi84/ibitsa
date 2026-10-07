import type { ReviewEvent } from '@ibitsa/protocol';
import type { ReviewStart } from '@ibitsa/runtime';
import type { ClaudeAdapterOptions } from './claude-adapter.types';

export interface ReviewSessionInit {
  adapter: ClaudeAdapterOptions;
  start: ReviewStart;
  onEvent: (event: ReviewEvent) => void;
}
