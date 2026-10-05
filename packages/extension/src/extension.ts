import { ClaudeAdapter } from '@ibitsa/agent-claude-sdk';
import { GitGameMaster } from '@ibitsa/runtime';
import * as vscode from 'vscode';
import { agentEnvironment } from './agent-environment';
import { API_KEY_SECRET, resolveCredentials } from './credentials';
import type { IbitsaApi } from './extension.types';
import { GAME_VIEW_TYPE, GamePanel } from './game-panel';
import { missingCredentialsAdapter } from './placeholders';
import { RuntimeHost } from './runtime-host';
import type { DependencyFactory, Notifier } from './runtime-host.types';
import { readUserSettings } from './settings';

export function activate(context: vscode.ExtensionContext): IbitsaApi {
  const testing = process.env.IBITSA_TESTING === '1';
  const config = () => vscode.workspace.getConfiguration('ibitsa');
  // In development the SDK may fall back to the developer's own Claude Code login (spec §11.6).
  const development = context.extensionMode === vscode.ExtensionMode.Development;
  let dependencies: DependencyFactory = ({ workspaceDir, credentials }) => {
    const env = agentEnvironment({ credentials, env: process.env, allowLogin: development });
    return {
      adapter: env
        ? new ClaudeAdapter({
            env: () => env,
            claudeCodePath: () => config().get<string>('claudeCodePath'),
            settingSources: () =>
              config().get<('project' | 'user' | 'local')[]>('hero.settingSources') ?? ['project'],
          })
        : missingCredentialsAdapter,
      gameMaster: new GitGameMaster({
        repoDir: workspaceDir,
        setupCommand: () => config().get<string>('worktree.setup') ?? '',
      }),
    };
  };
  let notify: Notifier = async (message) =>
    (await vscode.window.showInformationMessage(message, 'Open Game')) === 'Open Game';

  const openGame = () => GamePanel.show(context.extensionUri);
  const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const storageDir = context.storageUri?.fsPath;
  const host =
    workspaceDir && storageDir
      ? new RuntimeHost({
          storageDir,
          workspaceDir,
          dependencies: (inputs) => dependencies(inputs),
          credentials: () => resolveCredentials(context.secrets, process.env),
          settings: () => readUserSettings(vscode.workspace.getConfiguration('ibitsa')),
          notify: (message) => notify(message),
          gameVisible: () => GamePanel.visible,
          openGame,
          onWaitingChanged: (count) => GamePanel.setWaiting(count),
        })
      : null;
  GamePanel.host = host;
  if (testing) GamePanel.testLog = [];

  context.subscriptions.push(
    { dispose: () => host?.dispose() },
    vscode.commands.registerCommand('ibitsa.openGame', openGame),
    vscode.commands.registerCommand('ibitsa.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        title: 'Anthropic API key',
        prompt:
          'Stored in VS Code SecretStorage on this machine. Ibitsa never uses a claude.ai login.',
        password: true,
        ignoreFocusOut: true,
      });
      if (key === undefined) return;
      if (key.trim() === '') await context.secrets.delete(API_KEY_SECRET);
      else await context.secrets.store(API_KEY_SECRET, key.trim());
    }),
    vscode.commands.registerCommand('ibitsa.openWorktree', async () => {
      const path = host && (await host.state()).islands.find((i) => i.worktreePath)?.worktreePath;
      if (!path) {
        void vscode.window.showInformationMessage('There is no quest worktree to open.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), {
        forceNewWindow: true,
      });
    }),
    // Not contributed to the Command Palette: lets integration tests read the engine-check diagnostics.
    vscode.commands.registerCommand('ibitsa.internal.diagnostics', () => GamePanel.lastDiagnostics),
    vscode.window.registerWebviewPanelSerializer(GAME_VIEW_TYPE, {
      async deserializeWebviewPanel(panel) {
        GamePanel.revive(panel, context.extensionUri);
      },
    }),
  );

  if (!testing) return {};
  return {
    testing: {
      useDependencies: (factory) => {
        dependencies = factory;
      },
      useNotifier: (notifier) => {
        notify = notifier;
      },
      posted: () => GamePanel.testLog ?? [],
      receive: (raw) => GamePanel.deliver(raw),
      restartRuntime: async () => {
        host?.dispose();
        await GamePanel.reconnect();
      },
    },
  };
}

export function deactivate(): void {}
