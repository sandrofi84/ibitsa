import * as v from 'valibot';

// Hero classes and recolor in settings (spec §5.2, #182): `ibitsa.classes` and `ibitsa.recolor`. They
// come from user files, so they're checked before use.

const text = v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(60));

/** One class as `ibitsa.classes` sets it; missing fields keep the built-in's. */
export const ClassSettingSchema = v.strictObject({
  name: v.optional(text),
  /** A model alias (`fable`, `opus`, `sonnet`, `haiku`) or a full model id. */
  model: v.optional(text),
  /** A character in the pack, e.g. `hero.paladin`. */
  appearance: v.optional(text),
  names: v.optional(v.pipe(v.array(text), v.maxLength(10))),
});
export type ClassSetting = v.InferOutput<typeof ClassSettingSchema>;

/** A class id: a lowercase word. */
export const ClassIdSchema = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,30}$/));

/** Class id → its settings. */
export const ClassesSettingSchema = v.record(ClassIdSchema, ClassSettingSchema);

export const RECOLOR_PRESETS = ['none', 'gold', 'frost', 'ember', 'verdant', 'shadow'] as const;
export const RecolorPresetSchema = v.picklist(RECOLOR_PRESETS);
export type RecolorPreset = v.InferOutput<typeof RecolorPresetSchema>;

/** A recolor (§5.2): a hue shift in degrees, then a palette preset. */
export const RecolorSchema = v.strictObject({
  hue: v.optional(v.pipe(v.number(), v.minValue(-180), v.maxValue(180)), 0),
  preset: v.optional(RecolorPresetSchema, 'none'),
});
export type Recolor = v.InferOutput<typeof RecolorSchema>;

/** `class:<id>` or `councillor:<id>`. */
export const RecolorTargetSchema = v.pipe(
  v.string(),
  v.regex(/^(class|councillor):[a-z0-9:_-]{1,60}$/),
);
export const RecolorMapSchema = v.record(RecolorTargetSchema, RecolorSchema);
export type RecolorMap = v.InferOutput<typeof RecolorMapSchema>;
