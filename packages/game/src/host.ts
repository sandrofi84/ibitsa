// The page the game runs in: a VS Code webview, or a plain browser tab during standalone development.

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

/** Development diagnostics for the extension's engine check; replaced by protocol messages in #14. */
export function reportDiagnostics(diagnostics: Diagnostics): void {
  if (vscode) vscode.postMessage(diagnostics);
  else console.info('[ibitsa] diagnostics', diagnostics);
}
