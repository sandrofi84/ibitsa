import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentEvent } from '@ibitsa/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpAdapter } from './acp-adapter';
import {
  AgentSandbox,
  SANDBOX_PLAN_ENV,
  sandboxConfig,
  sandboxSupported,
  sharedGitDir,
} from './sandbox';
import type { NetworkRequest } from './sandbox.types';

const FAKE_AGENT = fileURLToPath(new URL('../test/fake-agent.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('../test/sandbox-host.mjs', import.meta.url));
vi.setConfig({ testTimeout: 30_000 });

/** macOS, or Linux with bubblewrap, socat and ripgrep; CI requires it rather than skipping. */
function canSandbox(): boolean {
  if (!sandboxSupported(process.platform)) return false;
  if (process.platform === 'darwin' || process.env.IBITSA_REQUIRE_SANDBOX === '1') return true;
  return ['bwrap', 'socat', 'rg'].every((tool) => spawnSync('which', [tool]).status === 0);
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

function folder(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ibitsa-sandbox-')));
  dirs.push(dir);
  return dir;
}

const profile = {
  stateFolders: ['/home/me/.codex'],
  domains: ['chatgpt.com', '*.oaiusercontent.com'],
};

describe('sandboxConfig (§11.5, #200)', () => {
  it('on macOS: the worktree, shared .git, temp and state folders; the bridge socket by path', () => {
    expect(
      sandboxConfig({
        cwd: '/work/tree',
        profile: { ...profile, weakerNetworkIsolation: true },
        platform: 'darwin',
        home: '/home/me',
        tmp: '/tmp/x',
        sharedGit: '/work/repo/.git',
        bridgeSocket: '/tmp/x/ibitsa-1.sock',
      }),
    ).toEqual({
      network: {
        allowedDomains: ['chatgpt.com', '*.oaiusercontent.com'],
        deniedDomains: [],
        allowUnixSockets: ['/tmp/x/ibitsa-1.sock'],
      },
      filesystem: {
        denyRead: ['/home/me/.ssh', '/home/me/.aws', '/home/me/.gnupg'],
        allowWrite: ['/work/tree', '/work/repo/.git', '/tmp/x', '/home/me/.codex'],
        denyWrite: [],
      },
      enableWeakerNetworkIsolation: true,
    });
  });

  it("on Linux: sockets can't be allowed by path, so all are, and the daemons' are hidden", () => {
    const config = sandboxConfig({
      cwd: '/work/tree',
      profile: { ...profile, weakerNetworkIsolation: true },
      platform: 'linux',
      home: '/home/me',
      tmp: '/tmp',
      sharedGit: null,
      bridgeSocket: '/tmp/ibitsa-1.sock',
    });
    expect(config.network).toEqual({
      allowedDomains: ['chatgpt.com', '*.oaiusercontent.com'],
      deniedDomains: [],
      allowAllUnixSockets: true,
    });
    expect(config.filesystem?.denyRead).toContain('/var/run/docker.sock');
    expect(config.filesystem?.allowWrite).toEqual(['/work/tree', '/tmp', '/home/me/.codex']);
    // The weaker isolation is a macOS matter (native TLS).
    expect(config).not.toHaveProperty('enableWeakerNetworkIsolation');
  });

  it('without a bridge on macOS, no socket is allowed', () => {
    const config = sandboxConfig({
      cwd: '/w',
      profile: { stateFolders: [], domains: [] },
      platform: 'darwin',
      home: '/h',
      tmp: '/t',
      sharedGit: null,
    });
    expect(config.network).toEqual({ allowedDomains: [], deniedDomains: [] });
  });
});

describe('sharedGitDir', () => {
  it("finds a worktree's main .git from its .git file", () => {
    const tree = folder();
    writeFileSync(join(tree, '.git'), 'gitdir: /work/repo/.git/worktrees/island-1\n');
    expect(sharedGitDir(tree)).toBe('/work/repo/.git');
  });

  it('reads a relative gitdir from the worktree', () => {
    const root = folder();
    mkdirSync(join(root, 'tree'));
    writeFileSync(join(root, 'tree', '.git'), 'gitdir: ../repo/.git/worktrees/a\n');
    expect(sharedGitDir(join(root, 'tree'))).toBe(join(root, 'repo', '.git'));
  });

  it('is null for a plain repository, a stray .git file or no repository', () => {
    const plain = folder();
    mkdirSync(join(plain, '.git'));
    expect(sharedGitDir(plain)).toBeNull();
    const stray = folder();
    writeFileSync(join(stray, '.git'), 'not a pointer');
    expect(sharedGitDir(stray)).toBeNull();
    const other = folder();
    writeFileSync(join(other, '.git'), 'gitdir: /somewhere/else\n');
    expect(sharedGitDir(other)).toBeNull();
    expect(sharedGitDir(folder())).toBeNull();
  });
});

describe('AgentSandbox', () => {
  it("hands the host its plan and relays the host's asks to the hero's session", async () => {
    const dir = folder();
    // Stands in for the host: reports its plan, asks twice, and prints the answers.
    const script = join(dir, 'host.mjs');
    writeFileSync(
      script,
      `const plan = JSON.parse(process.env.${SANDBOX_PLAN_ENV});
const answers = [];
process.on('message', (m) => {
  answers.push(m);
  if (answers.length === 2) {
    process.stdout.write(JSON.stringify({ plan, answers, run: process.env.ELECTRON_RUN_AS_NODE ?? null }));
    process.disconnect();
  }
});
process.send({ type: 'nonsense' });
process.send({ type: 'ask', id: 1, host: 'example.com', port: 443 });
process.send({ type: 'ask', id: 2, host: 'evil.test', port: null });
`,
    );
    const asked: NetworkRequest[] = [];
    const sandbox = new AgentSandbox({
      script,
      node: { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } },
      bridgeSocket: '/tmp/ibitsa-x.sock',
      platform: 'darwin',
      home: '/home/me',
      tmp: '/tmp/x',
    });
    const child = sandbox.spawn({
      request: {
        command: 'codex-acp',
        args: ['--flag'],
        cwd: dir,
        env: { PATH: process.env.PATH },
        ask: (request) => {
          asked.push(request);
          return request.host === 'example.com'
            ? Promise.resolve(true)
            : Promise.reject(new Error('x'));
        },
      },
      profile: { stateFolders: [], domains: ['chatgpt.com'] },
    });
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    await new Promise((resolve) => child.once('exit', resolve));
    const report = JSON.parse(out);
    expect(asked).toEqual([
      { host: 'example.com', port: 443 },
      { host: 'evil.test', port: null },
    ]);
    // A failed ask is a refusal.
    expect(report.answers).toEqual([
      { type: 'answer', id: 1, allow: true },
      { type: 'answer', id: 2, allow: false },
    ]);
    expect(report.run).toBe('1');
    expect(report.plan).toMatchObject({
      command: 'codex-acp',
      args: ['--flag'],
      cwd: dir,
      // The agent loses the plan and Electron's switch, which the agent's own env didn't have.
      unset: [SANDBOX_PLAN_ENV, 'ELECTRON_RUN_AS_NODE'],
      config: {
        network: { allowedDomains: ['chatgpt.com'], allowUnixSockets: ['/tmp/ibitsa-x.sock'] },
      },
    });
  });

  it('refuses every ask when the session has nobody to ask', async () => {
    const dir = folder();
    const script = join(dir, 'host.mjs');
    writeFileSync(
      script,
      `process.on('message', (m) => { process.stdout.write(JSON.stringify(m)); process.disconnect(); });
process.send({ type: 'ask', id: 7, host: 'example.com', port: 80 });
`,
    );
    const child = new AgentSandbox({ script, node: { command: process.execPath } }).spawn({
      request: { command: 'a', args: [], cwd: dir, env: { PATH: process.env.PATH } },
      profile: { stateFolders: [], domains: [] },
    });
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    await new Promise((resolve) => child.once('exit', resolve));
    expect(JSON.parse(out)).toEqual({ type: 'answer', id: 7, allow: false });
  });
});

describe.skipIf(!canSandbox())('a hero on an ACP agent inside the sandbox', () => {
  it('works in its worktree, is kept out of the rest, and asks before a new domain', async () => {
    const tree = folder();
    const outside = folder();
    const sandbox = new AgentSandbox({
      script: HOST,
      node: { command: process.execPath },
      tmp: join(tree, '.tmp'),
    });
    const sandboxProfile = { stateFolders: [], domains: [] };
    const adapter = new AcpAdapter({
      agent: { command: process.execPath, args: [FAKE_AGENT], mode: 'agent-full-access' },
      spawn: (request) => sandbox.spawn({ request, profile: sandboxProfile }),
      sandboxed: true,
    });
    expect(adapter.sandboxed).toBe(true);
    const events: AgentEvent[] = [];
    const steps = [
      { run: 'echo in > in.txt && cat in.txt' },
      { run: `echo out > ${outside}/out.txt` },
      { run: "curl -s -o /dev/null -w '%{http_code}' http://example.test/" },
    ];
    const session = adapter.startSession(
      {
        heroId: 'h1',
        sessionId: 's1',
        cwd: tree,
        classId: 'seer',
        prompt: JSON.stringify(steps),
      },
      (event) => {
        events.push(event);
        // The new domain reaches "Needs you"; the user refuses it.
        if (event.type === 'permission')
          session.respondToPermission({ requestId: event.requestId, decision: 'deny' });
      },
    );
    await vi.waitFor(() => expect(events.map((e) => e.type)).toContain('turnEnded'), {
      timeout: 25_000,
    });
    session.close();
    const said = events.flatMap((e) => (e.type === 'message' ? [e.text] : [])).join('\n');
    expect(said).toContain('run: 0 in');
    expect(said).toMatch(/run: [1-9]\d* .*(Operation not permitted|Read-only file system)/);
    expect(existsSync(join(outside, 'out.txt'))).toBe(false);
    expect(said).toContain('run: 0 403');
    const permission = events.find((e) => e.type === 'permission');
    expect(permission).toMatchObject({ tool: 'Network', input: { host: 'example.test:80' } });
    // Inside the sandbox, auto mode may answer: no boundary.
    expect(permission).not.toHaveProperty('boundary');
  });
});
