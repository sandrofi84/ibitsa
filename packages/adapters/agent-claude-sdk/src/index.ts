// Native Claude Agent SDK adapter (spec §11.3, §11.4).

export { CHAMBERS_INSTRUCTIONS } from './chambers-session';
export { ClaudeAdapter } from './claude-adapter';
export type { ClaudeAdapterOptions, SdkModule } from './claude-adapter.types';
export { CLASS_MODELS, DISPUTE_TOOL, HERO_INSTRUCTIONS, SUBMIT_TOOL } from './claude-session';
export { BRIEF_TOOL, ELDER_INSTRUCTIONS } from './elder-session';
export { heroSettings, sandboxProblem } from './hero-settings';
export { LESSONS_INSTRUCTIONS, LESSONS_TOOL } from './lessons-session';
export { REVIEW_INSTRUCTIONS, VERDICT_TOOL } from './review-session';
export { COUNCIL_TOOLS, ROUND_TABLE_INSTRUCTIONS } from './round-table-session';
