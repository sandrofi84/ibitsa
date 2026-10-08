import * as v from 'valibot';
import { AgentIdSchema } from './agents.schema';
import {
  ClassIdSchema,
  ClassSettingSchema,
  RecolorSchema,
  RecolorTargetSchema,
} from './classes.schema';

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

/** The volume settings (§9.4, #184), edited in the Guild Hall's Packs tab. */
export const SOUND_SETTINGS = [
  'sound.master',
  'sound.alerts',
  'sound.voices',
  'sound.effects',
  'sound.music',
  'sound.focus',
] as const;

/** Every setting the webview may read and write: the Rule book's and the volumes. */
export const SettingKeySchema = v.picklist([...RULE_BOOK, ...SOUND_SETTINGS]);
export type SettingKey = v.InferOutput<typeof SettingKeySchema>;

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

/** A councillor's id as a skill folder may be named (#181): lowercase words joined by hyphens. */
export const CouncillorIdSchema = v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]{0,40}$/));

const field = v.pipe(v.string(), v.trim(), v.maxLength(100));
/** `ibitsa.councillors.<id>` (#181): the fields a councillor's skill can be extended with. */
export const CouncillorOverrideSchema = v.strictObject({
  title: v.optional(field),
  model: v.optional(field),
  tools: v.optional(v.pipe(v.array(field), v.maxLength(10))),
  portrait: v.optional(field),
  agent: v.optional(field),
});

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
    key: SettingKeySchema,
    value: SettingValueSchema,
    layer: SettingLayerSchema,
  }),
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('resetSetting'),
    key: SettingKeySchema,
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
  // The Roster (#181): councillors on or off, their field overrides, customising and new ones.
  v.strictObject({ channel: v.literal('host'), type: v.literal('readCouncilSettings') }),
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('setCouncillorEnabled'),
    id: CouncillorIdSchema,
    enabled: v.boolean(),
    layer: SettingLayerSchema,
  }),
  /** `override` null removes the councillor's overrides from that layer. */
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('setCouncillorOverride'),
    id: CouncillorIdSchema,
    override: v.nullable(CouncillorOverrideSchema),
    layer: SettingLayerSchema,
  }),
  /** Copy a councillor's skill to your skills or the project's, and open it (replace, §4.7). */
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('customiseCouncillor'),
    id: CouncillorIdSchema,
    path: v.pipe(v.string(), v.nonEmpty(), v.maxLength(1024)),
    layer: SettingLayerSchema,
  }),
  /** Write a new councillor's skill from the template, and open it. */
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('newCouncillor'),
    id: CouncillorIdSchema,
    title: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(60)),
    description: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(300)),
    layer: SettingLayerSchema,
  }),
  // The Armory (#182): the classes and recolors with their layers, each written or reset by itself.
  v.strictObject({ channel: v.literal('host'), type: v.literal('readArmory') }),
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('writeClass'),
    id: ClassIdSchema,
    class: ClassSettingSchema,
    layer: SettingLayerSchema,
  }),
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('resetClass'),
    id: ClassIdSchema,
    layer: SettingLayerSchema,
  }),
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('writeRecolor'),
    target: RecolorTargetSchema,
    recolor: RecolorSchema,
    layer: SettingLayerSchema,
  }),
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('resetRecolor'),
    target: RecolorTargetSchema,
    layer: SettingLayerSchema,
  }),
  // The party check (§11.5, #199): each agent answers with an `agentCheck` event as it finishes;
  // `force` checks again instead of using a recent answer, e.g. after signing in.
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('checkAgents'),
    agents: v.pipe(v.array(AgentIdSchema), v.minLength(1), v.maxLength(20)),
    force: v.optional(v.boolean()),
  }),
  // Opens a terminal on the agent's sign-in, as its last check found it (#199).
  v.strictObject({
    channel: v.literal('host'),
    type: v.literal('signInAgent'),
    agent: AgentIdSchema,
  }),
]);

export type HostRequest = v.InferOutput<typeof HostRequestSchema>;
