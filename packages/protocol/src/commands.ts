import * as v from 'valibot';
import { CommandSchema } from './commands.schema';
import type { ParseCommandResult } from './commands.types';

export function parseCommand(input: unknown): ParseCommandResult {
  const result = v.safeParse(CommandSchema, input);
  if (result.success) return { ok: true, command: result.output };
  return {
    ok: false,
    issues: result.issues.map((issue) => {
      const path = v.getDotPath(issue);
      return path ? `${path}: ${issue.message}` : issue.message;
    }),
  };
}

/** The resume offer's id for the council (#293), beside the heroes' ids in `answerResume`. */
export const COUNCIL_RESUME = 'council';
