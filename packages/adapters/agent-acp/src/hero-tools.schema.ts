import * as v from 'valibot';

/** `submit_task`'s arguments, as the agent sends them (#197). */
export const SubmitTaskInputSchema = v.object({
  summary: v.pipe(v.string(), v.trim(), v.nonEmpty()),
});
