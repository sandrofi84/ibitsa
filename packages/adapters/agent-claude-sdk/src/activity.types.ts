import type { ActivityKind } from '@ibitsa/protocol';

export interface Activity {
  kind: ActivityKind;
  detail?: string;
}
