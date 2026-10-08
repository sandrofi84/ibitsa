import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import type { AcpAdapterOptions } from './acp-adapter.types';

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
  /** The process ended or could not start; not called after `close()`. */
  exited?: (message: string) => void;
}

export interface AgentConnectionInit {
  options: AcpAdapterOptions;
  cwd: string;
  handlers: ClientHandlers;
}
