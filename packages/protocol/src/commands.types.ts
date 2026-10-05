import type { Command } from './commands.schema';

export type ParseCommandResult = { ok: true; command: Command } | { ok: false; issues: string[] };
