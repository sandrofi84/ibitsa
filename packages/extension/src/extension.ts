import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ClaudeAdapter } from '@ibitsa/agent-claude-sdk';
import { GitHubHost } from '@ibitsa/githost-github';
import { heroHandle } from '@ibitsa/protocol';
import { GitGameMaster } from '@ibitsa/runtime';
import * as vscode from 'vscode';
import { agentEnvironment } from './agent-environment';
import { Armory } from './armory';
import { API_KEY_SECRET, resolveCredentials } from './credentials';
import { exportReplay } from './export-replay';
import type { ExportReplayArgs } from './export-replay.types';
import { exportTallies } from './export-tallies';
import type { ExportTalliesArgs } from './export-tallies.types';
import type { IbitsaApi } from './extension.types';
import { GAME_VIEW_TYPE, GamePanel } from './game-panel';
import { githubToken } from './github-sign-in';
import { GuildCouncil } from './guild-council';
import { GuildSettings } from './guild-settings';
import type { ExtensionManifest } from './guild-settings.types';
import { chooseHero } from './hero-choice';
import { API_KEYS_URL, HostChannel } from './host-channel';
import { anthropicKeyValidator } from './key-validator';
import type { KeyValidator } from './key-validator.types';
import { loginShellEnv } from './login-shell-env';
import { PackLibrary } from './packs';
import { missingCredentialsAdapter } from './placeholders';
import { pickHero, runAction } from './run-action';
import { RuntimeHost } from './runtime-host';
import type { DependencyFactory, Notifier } from './runtime-host.types';
import {
  readChecks,
  readClasses,
  readCouncillorOverrides,
  readCouncilMode,
  readDisabledCouncillors,
  readElderSettings,
  readPollSeconds,
  readRecolor,
  readUserSettings,
} from './settings';

export function activate(context: vscode.ExtensionContext): IbitsaApi {
  const testing = process.env.IBITSA_TESTING === '1';
  const config = () => vscode.workspace.getConfiguration('ibitsa');
  // In development the SDK may fall back to the developer's own Claude Code login (spec §11.6).
  const development = context.extensionMode === vscode.ExtensionMode.Development;
  let dependencies: DependencyFactory = ({ workspaceDir, credentials, env: base }) => {
    const env = agentEnvironment({ credentials, env: base, allowLogin: development });
    return {
      adapter: env
        ? new ClaudeAdapter({
            env: () => env,
            claudeCodePath: () => config().get<string>('claudeCodePath'),
            settingSources: () =>
              config().get<('project' | 'user' | 'local')[]>('hero.settingSources') ?? ['project'],
            pluginDirs: () => [vscode.Uri.joinPath(context.extensionUri, 'dist', 'plugin').fsPath],
            councillorOverrides: () => readCouncillorOverrides(config()),
          })
        : missingCredentialsAdapter,
      gameMaster: new GitGameMaster({
        repoDir: workspaceDir,
        setupCommand: () => config().get<string>('worktree.setup') ?? '',
        checks: () => readChecks(config()),
      }),
      gitHost: new GitHubHost({ token: githubToken }),
    };
  };
  let notify: Notifier = async (message) =>
    (await vscode.window.showInformationMessage(message, 'Open Game')) === 'Open Game';

  let validateKey: KeyValidator = anthropicKeyValidator();

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
          // A fresh login shell's environment, not VS Code's start-up copy (#67).
          environment: async () =>
            (await loginShellEnv({ shell: process.env.SHELL })) ?? process.env,
          settings: () => readUserSettings(vscode.workspace.getConfiguration('ibitsa')),
          elder: () => readElderSettings(vscode.workspace.getConfiguration('ibitsa')),
          councilMode: () => readCouncilMode(vscode.workspace.getConfiguration('ibitsa')),
          disabledCouncillors: () =>
            readDisabledCouncillors(vscode.workspace.getConfiguration('ibitsa')),
          pullRequestPollSeconds: () =>
            readPollSeconds(vscode.workspace.getConfiguration('ibitsa')),
          classes: () => readClasses(vscode.workspace.getConfiguration('ibitsa')),
          recolor: () => readRecolor(vscode.workspace.getConfiguration('ibitsa')),
          notify: (message) => notify(message),
          gameVisible: () => GamePanel.visible,
          openGame,
          onWaitingChanged: (count) => GamePanel.setWaiting(count),
        })
      : null;
  GamePanel.host = host;
  // Asset packs (#183): the user's and the project's, the active one drawn when the game opens.
  const packs = new PackLibrary({
    home: homedir(),
    workspace: workspaceDir,
    url: (path) => GamePanel.url(path) ?? '',
  });
  GamePanel.packs = {
    roots: () => packs.roots(),
    activeDir: () => packs.dir(config().get<string>('pack') ?? 'default'),
  };
  GamePanel.hostChannel = new HostChannel({
    credentials: () => resolveCredentials(context.secrets, process.env),
    development,
    storeApiKey: (key) => context.secrets.store(API_KEY_SECRET, key),
    validateKey: () => validateKey,
    openApiKeyPage: () => void vscode.env.openExternal(vscode.Uri.parse(API_KEYS_URL)),
    openWorktree: () => void vscode.commands.executeCommand('ibitsa.openWorktree'),
    post: (event) => GamePanel.postHost(event),
    // The Armory (#182): `ibitsa.classes` and `ibitsa.recolor`, one entry at a time.
    armory: new Armory({
      inspect: (key) => config().inspect(key),
      update: ({ key, value, layer }) =>
        config().update(
          key,
          value,
          layer === 'user'
            ? vscode.ConfigurationTarget.Global
            : vscode.ConfigurationTarget.Workspace,
        ),
    }),
    // The Guild Hall (#179): the Rule book over VS Code's own settings layers.
    settings: new GuildSettings({
      schema: (context.extension.packageJSON as ExtensionManifest).contributes.configuration
        .properties,
      inspect: (key) => config().inspect(key),
      update: ({ key, value, layer }) =>
        config().update(
          key,
          value,
          layer === 'user'
            ? vscode.ConfigurationTarget.Global
            : vscode.ConfigurationTarget.Workspace,
        ),
    }),
    openSettings: () =>
      void vscode.commands.executeCommand(
        'workbench.action.openSettings',
        `@ext:${context.extension.id}`,
      ),
    openFile: (path) => void vscode.window.showTextDocument(vscode.Uri.file(path)),
    packs,
    activePack: () => config().get<string>('pack') ?? 'default',
    setActivePack: (id) => config().update('pack', id, vscode.ConfigurationTarget.Global),
    packBase: (dir) => `${GamePanel.url(dir) ?? ''}/`,
    // The Roster (#181): councillors on or off, their overrides, customising and new ones.
    council: new GuildCouncil({
      inspect: (key) => config().inspect(key),
      update: ({ key, value, layer }) =>
        config().update(
          key,
          value,
          layer === 'user'
            ? vscode.ConfigurationTarget.Global
            : vscode.ConfigurationTarget.Workspace,
        ),
      files: {
        exists: (path) => existsSync(path),
        read: (path) => readFileSync(path, 'utf8'),
        write: ({ path, text }) => {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, text);
        },
      },
      roots: {
        home: homedir(),
        workspace: workspaceDir,
        plugin: vscode.Uri.joinPath(context.extensionUri, 'dist', 'plugin').fsPath,
      },
      open: (path) => void vscode.window.showTextDocument(vscode.Uri.file(path)),
    }),
    openable: {
      workspace: workspaceDir,
      roots: [
        join(homedir(), '.claude', 'skills'),
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'plugin').fsPath,
      ],
    },
  });
  if (testing) {
    GamePanel.testLog = [];
    GamePanel.hostTestLog = [];
  }

  context.subscriptions.push(
    { dispose: () => host?.dispose() },
    // Turning a councillor off or extending one changes who the council can seat (#181).
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('ibitsa.council.disabled') ||
        e.affectsConfiguration('ibitsa.councillors')
      )
        host?.refreshCouncillors();
    }),
    vscode.commands.registerCommand('ibitsa.openGame', openGame),
    vscode.commands.registerCommand('ibitsa.messageHero', async () => {
      // With several heroes, pick one: the bar opens addressed to it (#125).
      const state = host && (await host.state());
      const several = (state?.heroes.length ?? 0) > 1;
      const hero = several ? await chooseHero({ state, pick: pickHero }) : null;
      if (several && !hero) return;
      openGame();
      GamePanel.postHost(
        hero
          ? { channel: 'host', type: 'fillCommandBar', text: `@${heroHandle(hero.name)} ` }
          : { channel: 'host', type: 'focusCommandBar' },
      );
    }),
    vscode.commands.registerCommand('ibitsa.runAction', (picked?: { name: string; args: string }) =>
      runAction({ host, picked, open: openGame }),
    ),
    vscode.commands.registerCommand('ibitsa.stopHero', async () => {
      const state = host && (await host.state());
      const hero = await chooseHero({ state, pick: pickHero });
      if (!host || !hero) {
        void vscode.window.showInformationMessage('No hero is on a quest.');
        return;
      }
      await host.command({ type: 'stopHero', heroId: hero.id });
    }),
    vscode.commands.registerCommand('ibitsa.newQuest', () => {
      openGame();
      GamePanel.postHost({ channel: 'host', type: 'openNewQuest' });
    }),
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
    vscode.commands.registerCommand('ibitsa.exportReplay', (args?: ExportReplayArgs) =>
      exportReplay({ storageDir, workspaceDir, args }),
    ),
    vscode.commands.registerCommand('ibitsa.exportTallies', (args?: ExportTalliesArgs) =>
      exportTallies({ storageDir, workspaceDir, args }),
    ),
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
      useKeyValidator: (validator) => {
        validateKey = validator;
      },
      posted: () => GamePanel.testLog ?? [],
      hostEvents: () => GamePanel.hostTestLog ?? [],
      storageDir: () => storageDir,
      forgetApiKey: () => context.secrets.delete(API_KEY_SECRET),
      receive: (raw) => GamePanel.deliver(raw),
      restartRuntime: async () => {
        host?.dispose();
        await GamePanel.reconnect();
      },
    },
  };
}

export function deactivate(): void {}
