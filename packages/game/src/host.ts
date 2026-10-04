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

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare const acquireVsCodeApi: (() => VsCodeApi) | undefined;

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;

export function reportDiagnostics(diagnostics: Diagnostics): void {
  if (vscode) vscode.postMessage(diagnostics);
}

const CORE_MESSAGE_TYPES = new Set(['welcome', 'snapshot', 'cue']);

/** The webview side of the extension: commands out via postMessage, core messages in via `message`. */
export function webviewHost(): Host {
  return {
    send: (command) => vscode?.postMessage(command),
    onMessage: (listener) => {
      window.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as { type?: unknown } | null;
        if (data && typeof data.type === 'string' && CORE_MESSAGE_TYPES.has(data.type)) {
          listener(data as CoreMessage);
        }
      });
    },
  };
}
