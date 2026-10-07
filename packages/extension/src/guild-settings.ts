import { RULE_BOOK, type RuleKey, type SettingValue, type SettingView } from '@ibitsa/protocol';
import type { GuildSettingsDeps, SettingSchema } from './guild-settings.types';

/**
 * The Guild Hall's Rule book over VS Code's settings (§7.1, §8.1, #179): each rule with its value and
 * the layer it comes from, written to or reset at your layer or the project's. VS Code's settings stay
 * the only store.
 */
export class GuildSettings {
  constructor(private readonly deps: GuildSettingsDeps) {}

  rules(): SettingView[] {
    return RULE_BOOK.map((key) => this.view(key));
  }

  async write({
    key,
    value,
    layer,
  }: {
    key: RuleKey;
    value: SettingValue;
    layer: 'user' | 'workspace';
  }): Promise<void> {
    await this.deps.update({ key, value, layer });
  }

  /** Removes the rule from that layer, so the one below applies again. */
  async reset({ key, layer }: { key: RuleKey; layer: 'user' | 'workspace' }): Promise<void> {
    await this.deps.update({ key, value: undefined, layer });
  }

  private view(key: RuleKey): SettingView {
    const schema = this.deps.schema[`ibitsa.${key}`] ?? {};
    const layers = this.deps.inspect(key) ?? {};
    const defaultValue = asValue(layers.defaultValue ?? schema.default ?? null);
    const user = layers.globalValue === undefined ? undefined : asValue(layers.globalValue);
    const workspace =
      layers.workspaceValue === undefined ? undefined : asValue(layers.workspaceValue);
    const types = [schema.type ?? []].flat();
    return {
      key,
      description: (schema.markdownDescription ?? schema.description ?? '').replaceAll('`', ''),
      kind: kindOf(schema),
      ...(schema.enum ? { choices: schema.enum } : {}),
      nullable: types.includes('null'),
      ...(schema.minimum === undefined ? {} : { minimum: schema.minimum }),
      value: workspace ?? user ?? defaultValue,
      layer: workspace !== undefined ? 'workspace' : user !== undefined ? 'user' : 'default',
      defaultValue,
      ...(user === undefined ? {} : { user }),
      ...(workspace === undefined ? {} : { workspace }),
    };
  }
}

function kindOf(schema: SettingSchema): SettingView['kind'] {
  const types = [schema.type ?? []].flat();
  if (schema.enum) return 'choice';
  if (types.includes('array')) return 'list';
  if (types.includes('integer')) return 'integer';
  if (types.includes('number')) return 'number';
  return 'text';
}

/** A value from VS Code, as one the Rule book can show; anything else shows as none. */
function asValue(value: unknown): SettingValue {
  if (value === null || ['number', 'string', 'boolean'].includes(typeof value))
    return value as SettingValue;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value;
  return null;
}
