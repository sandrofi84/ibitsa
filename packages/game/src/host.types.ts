import type { Command, CoreMessage, HostEvent, HostRequest } from '@ibitsa/protocol';
import type { ViewStorage } from './view-state.types';

/** Where the game's core lives: the extension (webview) or an in-browser dev harness (standalone). */
export interface Host {
  send(command: Command): void;
  onMessage(listener: (message: CoreMessage) => void): void;
  /** The extension channel outside the protocol: credentials, worktree windows (#37). */
  request(request: HostRequest): void;
  onHostEvent(listener: (event: HostEvent) => void): void;
  /** Where view-only state (open panes, camera) is kept (spec §7.4). */
  readonly viewStorage: ViewStorage;
}

/** Development diagnostics for the extension's engine check (#13). */
export interface Diagnostics {
  type: 'diagnostics';
  ready: boolean;
  renderer: 'webgl' | 'none';
  zoom: number;
  canvas: { width: number; height: number } | null;
  cspViolations: string[];
}

export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
