import { randomBytes } from 'node:crypto';
import type { CoreMessage } from '@ibitsa/protocol';
import type { Connection } from '@ibitsa/runtime';
import * as vscode from 'vscode';
import type { GameDiagnostics } from './game-panel.types';
import type { RuntimeHost } from './runtime-host';

export const GAME_VIEW_TYPE = 'ibitsa.game';

/** The game as a single editor tab (spec §7.1). */
export class GamePanel {
  private static current: GamePanel | undefined;
  static lastDiagnostics: GameDiagnostics | undefined;
  /** Null without a workspace folder: the game opens, but no quest can run. */
  static host: RuntimeHost | null = null;
  /** Messages sent to the webview, kept only when integration tests ask for them. */
  static testLog: CoreMessage[] | null = null;
  private static waiting = 0;

  static get visible(): boolean {
    return GamePanel.current?.panel.visible ?? false;
  }

  /** VS Code editor tabs have no badge, so the title carries the "Needs you" count (spec §6.4). */
  static setWaiting(count: number): void {
    GamePanel.waiting = count;
    GamePanel.current?.updateTitle();
  }

  /** Feeds a message as if the webview sent it (integration tests). */
  static deliver(raw: unknown): void {
    GamePanel.current?.receive(raw);
  }

  /** Reconnects to a restarted runtime (integration tests simulate a window reload this way). */
  static async reconnect(): Promise<void> {
    await GamePanel.current?.connect();
  }

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

  private connection: Connection | null = null;
  /** Messages that arrived before the runtime finished starting. */
  private pending: unknown[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
  ) {
    panel.webview.html = renderHtml(panel.webview, extensionUri);
    panel.webview.onDidReceiveMessage((message: unknown) => this.receive(message));
    panel.onDidDispose(() => {
      this.connection?.close();
      if (GamePanel.current?.panel === panel) GamePanel.current = undefined;
    });
    this.updateTitle();
    this.connect().catch((e: unknown) =>
      console.error('[ibitsa] could not connect to the runtime', e),
    );
  }

  private async connect(): Promise<void> {
    this.connection?.close();
    this.connection = null;
    const host = GamePanel.host;
    if (!host) return;
    const connection = await host.connect({
      post: (message) => {
        GamePanel.testLog?.push(message);
        void this.panel.webview.postMessage(message);
      },
    });
    this.connection = connection;
    for (const message of this.pending.splice(0)) connection.receive(message);
  }

  private receive(message: unknown): void {
    if (isDiagnostics(message)) {
      GamePanel.lastDiagnostics = message;
      return;
    }
    if (this.connection) this.connection.receive(message);
    else if (GamePanel.host) this.pending.push(message);
  }

  private updateTitle(): void {
    this.panel.title = GamePanel.waiting > 0 ? `Ibitsa · ${GamePanel.waiting} waiting` : 'Ibitsa';
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
