import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export const GAME_VIEW_TYPE = 'ibitsa.game';

/** Development diagnostics posted by the game for the engine check (#13); protocol messages replace them in #14. */
export interface GameDiagnostics {
  type: 'diagnostics';
  ready: boolean;
  renderer: 'webgl' | 'none';
  zoom: number;
  canvas: { width: number; height: number } | null;
  cspViolations: string[];
}

/** The game as a single editor tab (spec §7.1). */
export class GamePanel {
  private static current: GamePanel | undefined;
  static lastDiagnostics: GameDiagnostics | undefined;

  static show(extensionUri: vscode.Uri): void {
    if (GamePanel.current) {
      GamePanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      GAME_VIEW_TYPE,
      'Ibitsa',
      vscode.ViewColumn.Active,
      GamePanel.webviewOptions(extensionUri),
    );
    GamePanel.current = new GamePanel(panel, extensionUri);
  }

  /** Called by the serializer when VS Code restores the tab after a window reload. */
  static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    panel.webview.options = GamePanel.webviewOptions(extensionUri);
    GamePanel.current = new GamePanel(panel, extensionUri);
  }

  private static webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
    };
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
  ) {
    panel.webview.html = renderHtml(panel.webview, extensionUri);
    panel.webview.onDidReceiveMessage((message: unknown) => {
      if (isDiagnostics(message)) GamePanel.lastDiagnostics = message;
    });
    panel.onDidDispose(() => {
      if (GamePanel.current?.panel === panel) GamePanel.current = undefined;
    });
  }
}

function isDiagnostics(message: unknown): message is GameDiagnostics {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'diagnostics'
  );
}

/**
 * Strict CSP (spec §13): no `unsafe-eval`, scripts only with the nonce, resources only from the extension.
 * `img-src data:` is the agreed fallback: Phaser probes Canvas blend modes with two data: PNGs when its
 * module loads, before any game exists (src/device/CanvasFeatures.js).
 */
function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const root = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const asset = (path: string) => webview.asWebviewUri(vscode.Uri.joinPath(root, path)).toString();
  const nonce = randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `connect-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  const forceNoWebgl = process.env.IBITSA_FORCE_NO_WEBGL === '1';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${asset('main.css')}" />
    <title>Ibitsa</title>
  </head>
  <body>
    <div id="game" data-asset-base="${asset('')}/" data-force-no-webgl="${forceNoWebgl}"></div>
    <script type="module" nonce="${nonce}" src="${asset('main.js')}"></script>
  </body>
</html>`;
}
