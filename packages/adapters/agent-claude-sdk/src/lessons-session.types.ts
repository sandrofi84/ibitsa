import type { LessonsEvent } from '@ibitsa/protocol';
import type { LessonsStart } from '@ibitsa/runtime';
import type { ClaudeAdapterOptions } from './claude-adapter.types';

export interface LessonsSessionInit {
  adapter: ClaudeAdapterOptions;
  start: LessonsStart;
  onEvent: (event: LessonsEvent) => void;
}
