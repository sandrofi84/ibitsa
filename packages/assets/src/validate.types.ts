import type { Manifest } from './manifest.schema.ts';

export type PackValidation = { ok: true; manifest: Manifest } | { ok: false; errors: string[] };
