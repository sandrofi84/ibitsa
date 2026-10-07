import * as v from 'valibot';

// Webview → extension requests that are not core commands (spec §11.6, #37). They never reach the
// runtime, core or the event log, so the API key can travel here. Validated at the extension: the
// webview is untrusted.

/**
 * The rules the Guild Hall's Rule book shows and edits (§7.1, #179), without the `ibitsa.` prefix. Only
 * these can be written from the webview.
 */
export const RULE_BOOK = [
  'review.loopLimit',
  'checks',
  'parties.maxParallel',
  'hero.budgetUsd',
  'campaign.budgetUsd',
  'elder.model',
  'elder.budgetUsd',
  'council.mode',
  'council.consultBudgetUsd',
  'pullRequests.pollSeconds',
  'worktree.setup',
] as const;
export const RuleKeySchema = v.picklist(RULE_BOOK);
export type RuleKey = v.InferOutput<typeof RuleKeySchema>;

/** A setting's value as the Rule book edits it: a number, text, a list of commands, or none. */
export const SettingValueSchema = v.union([
  v.number(),
  v.string(),
  v.boolean(),
  v.null(),
  v.pipe(v.array(v.pipe(v.string(), v.maxLength(500))), v.maxLength(50)),
]);
export type SettingValue = v.InferOutput<typeof SettingValueSchema>;

/** Where a setting is written (§8.1): your settings, or this project's (`.vscode/settings.json`). */
export const SettingLayerSchema = v.picklist(['user', 'workspace']);

export const HostRequestSchema = v.variant('type', [
  v.strictObject({ channel: v.literal('host'), type: v.literal('credentialsStatus') }),
  v.strictObject({ channel: v.literal('host'), type: v.literal('openApiKeyPage') }),
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('saveApiKey'),
    key: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(512)),
  }),
  v.strictObject({ channel: v.literal('host'), type: v.literal('openWorktree') }),
  // The Guild Hall (#179): the rules with their layers, writing and resetting one, VS Code's settings.
  v.strictObject({ channel: v.literal('host'), type: v.literal('readSettings') }),
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('writeSetting'),
    key: RuleKeySchema,
    value: SettingValueSchema,
    layer: SettingLayerSchema,
  }),
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('resetSetting'),
    key: RuleKeySchema,
    layer: SettingLayerSchema,
  }),
  v.strictObject({ channel: v.literal('host'), type: v.literal('openSettings') }),
  // Asset packs (#183): the packs found, and using one (`default`, `user:<folder>` or `project:<folder>`).
  v.strictObject({ channel: v.literal('host'), type: v.literal('readPacks') }),
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('usePack'),
    id: v.pipe(v.string(), v.regex(/^(default|(user|project):[\w.-]{1,100})$/)),
  }),
  /** Open a file in the editor: a record, a skill. Relative paths are the workspace's (#179). */
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('openFile'),
    path: v.pipe(v.string(), v.nonEmpty(), v.maxLength(1024)),
  }),
]);

export type HostRequest = v.InferOutput<typeof HostRequestSchema>;
