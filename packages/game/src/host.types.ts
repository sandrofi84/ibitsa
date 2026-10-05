import type { Command, CoreMessage } from '@ibitsa/protocol';

/** Where the game's core lives: the extension (webview) or an in-browser dev harness (standalone). */
export interface Host {
  send(command: Command): void;
  onMessage(listener: (message: CoreMessage) => void): void;
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
}
