import { randomBytes } from 'node:crypto';
import type { CoreMessage, HostEvent } from '@ibitsa/protocol';
import type { Connection } from '@ibitsa/runtime';
import * as vscode from 'vscode';
import type { GameDiagnostics } from './game-panel.types';
import { type HostChannel, isHostMessage } from './host-channel';
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
  /** Credentials and editor actions; host messages never reach the runtime (spec §11.6). */
  static hostChannel: HostChannel | null = null;
  /** Host events sent to the webview, kept only when integration tests ask for them. */
  static hostTestLog: HostEvent[] | null = null;
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

  /** Sends a host event, held until the game has said hello so a just-opened tab doesn't miss it. */
  static postHost(event: HostEvent): void {
    GamePanel.hostTestLog?.push(event);
    const current = GamePanel.current;
    if (!current) return;
    if (current.ready) void current.panel.webview.postMessage(event);
    else current.heldHostEvents.push(event);
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

  /** The asset packs (#183): their folders may be loaded by the webview, and the active one is drawn. */
  static packs: { roots(): string[]; activeDir(): string | null } | null = null;

  /** A file's address in the open game tab, e.g. a pack's sprite sheet (#183); null without one. */
  static url(path: string): string | null {
    return GamePanel.current?.panel.webview.asWebviewUri(vscode.Uri.file(path)).toString() ?? null;
  }

  private static webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
        ...(GamePanel.packs?.roots() ?? []).map((root) => vscode.Uri.file(root)),
      ],
    };
  }

  private connection: Connection | null = null;
  /** Messages that arrived before the runtime finished starting. */
  private pending: unknown[] = [];
  private ready = false;
  private heldHostEvents: HostEvent[] = [];

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
    if (isHostMessage(message)) {
      GamePanel.hostChannel
        ?.receive(message)
        .catch((e: unknown) => console.error('[ibitsa] host request failed', e));
      return;
    }
    if ((message as { type?: unknown } | null)?.type === 'hello') {
      this.ready = true;
      for (const event of this.heldHostEvents.splice(0)) void this.panel.webview.postMessage(event);
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
  // A user's or project's pack (#183); the bundled one otherwise.
  const packDir = GamePanel.packs?.activeDir();
  const packBase = packDir ? `${webview.asWebviewUri(vscode.Uri.file(packDir)).toString()}/` : null;
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
    <div id="game" data-asset-base="${asset('')}/"${packBase ? ` data-pack-base="${packBase}"` : ''} data-force-no-webgl="${forceNoWebgl}"></div>
    <script type="module" nonce="${nonce}" src="${asset('main.js')}"></script>
  </body>
</html>`;
}
