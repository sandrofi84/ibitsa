import type { ElderEvent } from '@ibitsa/protocol';
import type { ElderStart } from '@ibitsa/runtime';
import type { ClaudeAdapterOptions } from './claude-adapter.types';

export interface ElderSessionInit {
  adapter: ClaudeAdapterOptions;
  start: ElderStart;
  onEvent: (event: ElderEvent) => void;
}

/** What a tool handler returns to the model (a type, so it fits the SDK's indexed result type). */
export type ToolReply = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};
