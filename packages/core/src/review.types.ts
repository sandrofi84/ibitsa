import type { Island } from './state.types';

/** One task point of an island, as the review loop works on it. */
export type TaskPoint = Island['taskPoints'][number];
