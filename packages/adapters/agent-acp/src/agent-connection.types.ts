import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import type { AcpAdapterOptions } from './acp-adapter.types';
import type { NetworkRequest } from './sandbox.types';

/** What the client answers for the agent; anything left out is declined or ignored. */
export interface ClientHandlers {
  permission?: (request: {
    params: RequestPermissionRequest;
    signal: AbortSignal;
  }) => Promise<RequestPermissionResponse>;
  elicit?: (request: {
    params: CreateElicitationRequest;
    signal: AbortSignal;
  }) => Promise<CreateElicitationResponse>;
  update?: (notification: SessionNotification) => void;
  /** A new domain under the sandbox (#200); without a handler it is refused. */
  ask?: (request: NetworkRequest) => Promise<boolean>;
  /** The process ended or could not start; not called after `close()`. */
  exited?: (message: string) => void;
}

export interface AgentConnectionInit {
  options: AcpAdapterOptions;
  cwd: string;
  handlers: ClientHandlers;
}
