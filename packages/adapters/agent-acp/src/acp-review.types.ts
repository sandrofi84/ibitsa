import type { ReviewEvent } from '@ibitsa/protocol';
import type { ReviewStart } from '@ibitsa/runtime';
import type { AcpAdapterOptions } from './acp-adapter.types';

export interface AcpReviewInit {
  options: AcpAdapterOptions;
  start: ReviewStart;
  onEvent: (event: ReviewEvent) => void;
}
