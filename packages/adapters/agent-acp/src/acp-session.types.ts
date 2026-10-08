import type {
  CreateElicitationResponse,
  PermissionOption,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import type { AgentEvent } from '@ibitsa/protocol';
import type { AcpAdapterOptions } from './acp-adapter.types';
import type { FormField } from './elicitation.types';

export interface AcpSessionInit {
  options: AcpAdapterOptions;
  heroId: string;
  /** The hero's worktree. */
  cwd: string;
  /** The class's model, set through the agent's `model` config option when it offers one. */
  model?: string;
  /** The first message; a resumed session without one waits idle. */
  prompt?: string;
  /** An earlier session to continue (`session/resume`, else `session/load`). */
  resume?: string;
  /**
   * Rules already allowed for the quest (#62, #200): a request whose rule is among them is allowed
   * without asking. An ACP agent's rule is the request as shown, e.g. `Run npm test`.
   */
  allowRules?: string[];
  onEvent: (event: AgentEvent) => void;
}

/** A permission request waiting for "Needs you". */
export interface PendingPermission {
  options: PermissionOption[];
  resolve: (response: RequestPermissionResponse) => void;
  /** What "Always allow" adds for the quest, when the agent offers it (#200). */
  rule?: string;
}

/** A form waiting for "Needs you", with how its answers map back to its fields. */
export interface PendingQuestion {
  fields: FormField[];
  resolve: (response: CreateElicitationResponse) => void;
}
