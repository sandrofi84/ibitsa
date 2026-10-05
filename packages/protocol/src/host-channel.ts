import * as v from 'valibot';
import { type HostRequest, HostRequestSchema } from './host-channel.schema';

/** A host request from the webview, or null if the message isn't one (or is malformed). */
export function parseHostRequest(input: unknown): HostRequest | null {
  const result = v.safeParse(HostRequestSchema, input);
  return result.success ? result.output : null;
}
