import type { Manifest } from './manifest.schema.ts';

export type PackValidation =
  | { ok: true; manifest: Manifest; warnings: string[] }
  | { ok: false; errors: string[] };
