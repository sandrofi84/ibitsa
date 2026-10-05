import type { CoreMessage, HostEvent } from '@ibitsa/protocol';
import type { Diagnostics, Host, VsCodeApi } from './host.types';

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
    request: (request) => vscode?.postMessage(request),
    onHostEvent: (listener) => {
      window.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as { channel?: unknown } | null;
        if (data?.channel === 'host') listener(data as HostEvent);
      });
    },
  };
}
