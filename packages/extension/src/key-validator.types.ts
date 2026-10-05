/** Whether Anthropic accepts an API key (spec §11.6). */
export type KeyVerdict = { ok: true } | { ok: false; reason: string };

export type KeyValidator = (key: string) => Promise<KeyVerdict>;
