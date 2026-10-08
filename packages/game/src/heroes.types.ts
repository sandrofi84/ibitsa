export interface HeroClass {
  id: string;
  label: string;
  /** Shown next to the class: which model it runs (spec §5.2). */
  model: string;
  /** The agent its heroes run on (§11.5): `claude`, or an ACP agent the party check looks at (#199). */
  agent: string;
  /** The model id or alias as set; empty: the ACP agent's own choice. */
  modelId: string;
  /** Suggested names; the user may type their own. */
  names: string[];
  /** The pack character its heroes look like (#182). */
  appearance: string;
}
