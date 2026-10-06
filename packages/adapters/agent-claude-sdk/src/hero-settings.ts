import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import type {
  HeroSettings,
  HeroSettingsInput,
  OfferedRules,
  PermissionRequest,
} from './hero-settings.types';

/** Test commands allowed without asking on native Windows, where there is no sandbox (spec §11.6). */
const TEST_COMMANDS = [
  'pnpm test',
  'pnpm run test',
  'npm test',
  'npm run test',
  'yarn test',
  'bun test',
  'npx vitest',
  'vitest',
  'npx jest',
  'jest',
  'pytest',
  'go test',
  'cargo test',
  'npx playwright test',
];

/**
 * The hero session settings from spec §11.6 (checked against the SDK 0.3.289 types): edits inside the
 * worktree run without asking; shell commands run without asking inside the OS sandbox, which confines
 * writes to the worktree; escaping the sandbox always asks; everything else goes to "Needs you".
 */
export function heroSettings({
  platform,
  settingSources,
  testScripts,
  allowRules,
}: HeroSettingsInput): HeroSettings {
  const common: HeroSettings = {
    // Explicit: omitting it can start a session in auto mode (#11).
    permissionMode: 'acceptEdits',
    settingSources,
  };
  if (platform === 'win32') {
    // Native Windows has no sandbox: non-read-only commands ask, except test runs.
    const commands = [
      ...TEST_COMMANDS,
      ...testScripts.flatMap((name) => [
        `pnpm ${name}`,
        `pnpm run ${name}`,
        `npm run ${name}`,
        `yarn ${name}`,
      ]),
    ];
    return {
      ...common,
      allowedTools: [...commands.flatMap((c) => [`Bash(${c})`, `Bash(${c} *)`]), ...allowRules],
    };
  }
  return {
    ...common,
    // failIfUnavailable: a missing sandbox is an error, never a silent unsandboxed run.
    sandbox: { enabled: true, autoAllowBashIfSandboxed: true, failIfUnavailable: true },
    // Flag-level settings, so a repository's own settings can't loosen it.
    // "Always allow" rules join them there; the escape stays an ask whatever they say.
    settings: {
      permissions: {
        ask: ['Bash(dangerouslyDisableSandbox:true)'],
        ...(allowRules.length > 0 ? { allow: [...allowRules] } : {}),
      },
    },
    allowedTools: [],
  };
}

/** On Linux and WSL2 the sandbox needs bubblewrap and socat; say exactly what is missing. */
export function sandboxProblem({
  platform,
  hasCommand = commandExists,
}: {
  platform: NodeJS.Platform;
  hasCommand?: (name: string) => boolean;
}): string | null {
  if (platform !== 'linux') return null;
  const missing = [
    ['bwrap', 'bubblewrap'],
    ['socat', 'socat'],
  ].filter(([command]) => !hasCommand(command as string));
  if (missing.length === 0) return null;
  const packages = missing.map(([, pkg]) => pkg).join(' ');
  return `The hero sandbox needs ${missing.map(([, pkg]) => pkg).join(' and ')}. Install with your package manager, e.g. \`sudo apt-get install ${packages}\`, then resume.`;
}

export function commandExists(name: string): boolean {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/**
 * Which hard limit a request crosses, if any (spec §11.6): escaping the sandbox, or touching anything
 * outside the worktree (a blocked path, an extra directory, a file tool aimed elsewhere). Neither
 * "Always allow" (#62) nor auto mode (#63) ever covers these.
 */
export function boundaryOf({
  toolName,
  input,
  cwd,
  suggestions = [],
  blockedPath,
}: PermissionRequest): 'sandboxEscape' | 'outsideWorktree' | null {
  if (input.dangerouslyDisableSandbox === true) return 'sandboxEscape';
  if (blockedPath || suggestions.some((s) => s.type === 'addDirectories')) return 'outsideWorktree';
  const file = input.file_path ?? input.notebook_path;
  if (FILE_TOOLS.has(toolName) && (typeof file !== 'string' || !inside({ path: file, dir: cwd }))) {
    return 'outsideWorktree';
  }
  return null;
}

/**
 * What "Always allow" may offer for a request (#62): the SDK's own suggested allow rules, for this
 * session only, and nothing across a hard limit.
 */
export function offeredRules(request: PermissionRequest): OfferedRules {
  const none: OfferedRules = { rules: [], updates: [] };
  if (boundaryOf(request)) return none;
  const suggestions = request.suggestions ?? [];
  const updates = suggestions.flatMap((s) =>
    s.type === 'addRules' && s.behavior === 'allow'
      ? [{ ...s, destination: 'session' as const }]
      : [],
  );
  const rules = updates.flatMap((u) =>
    u.type === 'addRules'
      ? u.rules.map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName))
      : [],
  );
  return rules.length > 0 ? { rules, updates } : none;
}

/** Is `path` the worktree or inside it, as given or through symlinks (macOS /var → /private/var)? */
function inside({ path, dir }: { path: string; dir: string }): boolean {
  return [dir, resolved(dir)].some(
    (d) => path === d || path.startsWith(`${d}/`) || path.startsWith(`${d}\\`),
  );
}

function resolved(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}
