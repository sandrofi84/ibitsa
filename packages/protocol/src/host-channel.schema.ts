import * as v from 'valibot';

// Webview → extension requests that are not core commands (spec §11.6, #37). They never reach the
// runtime, core or the event log, so the API key can travel here. Validated at the extension: the
// webview is untrusted.

export const HostRequestSchema = v.variant('type', [
  v.strictObject({ channel: v.literal('host'), type: v.literal('credentialsStatus') }),
  v.strictObject({ channel: v.literal('host'), type: v.literal('openApiKeyPage') }),
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('saveApiKey'),
    key: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(512)),
  }),
  v.strictObject({ channel: v.literal('host'), type: v.literal('openWorktree') }),
]);

export type HostRequest = v.InferOutput<typeof HostRequestSchema>;
