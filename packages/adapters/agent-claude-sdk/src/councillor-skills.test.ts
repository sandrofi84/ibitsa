import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';
import { CouncillorSkills } from './councillor-skills';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-councillors-'));
  dirs.push(dir);
  return dir;
}
function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}
const skill = (fields: string, body = '## Planning\nLook.\n') => `---\n${fields}\n---\n${body}`;

function folders() {
  const cwd = temp();
  const home = temp();
  const plugin = temp();
  write(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'ibitsa' }));
  return { cwd, home, plugin };
}

describe('CouncillorSkills (#98)', () => {
  it('lists marked skills from built-ins, the user and the project, and nothing else', () => {
    const { cwd, home, plugin } = folders();
    write(
      join(plugin, 'skills', 'security', 'SKILL.md'),
      skill(
        'name: security\ndescription: Trust boundaries\nibitsa-councillor: true',
        '## Planning\nA.\n## Review\nB.\n',
      ),
    );
    write(join(plugin, 'skills', 'test', 'SKILL.md'), skill('name: test'));
    write(
      join(home, '.claude', 'skills', 'perf', 'SKILL.md'),
      skill(
        'name: perf\nibitsa-councillor: true\nibitsa-title: Performance\nibitsa-portrait: councillor.elder\nibitsa-model: haiku',
        '## Review\nOnly reviews.\n',
      ),
    );
    write(join(cwd, '.claude', 'skills', 'notes.md'), 'a stray file, not a skill folder');
    write(join(cwd, '.claude', 'skills', 'empty', 'README.md'), 'no SKILL.md here');

    expect(new CouncillorSkills({ cwd, home, pluginDirs: [plugin] }).list()).toEqual([
      {
        id: 'perf',
        skill: 'perf',
        title: 'Performance',
        description: '',
        source: 'user',
        portrait: 'councillor.elder',
        model: 'haiku',
        tools: ['Read', 'Grep', 'Glob'],
        modes: { planning: false, review: true },
        hash: expect.stringMatching(/^[0-9a-f]{12}$/),
        path: join(home, '.claude', 'skills', 'perf', 'SKILL.md'),
      },
      {
        id: 'security',
        skill: 'ibitsa:security',
        title: 'Security',
        description: 'Trust boundaries',
        source: 'builtin',
        portrait: null,
        model: null,
        tools: ['Read', 'Grep', 'Glob'],
        modes: { planning: true, review: true },
        hash: expect.stringMatching(/^[0-9a-f]{12}$/),
        path: join(plugin, 'skills', 'security', 'SKILL.md'),
      },
    ]);
  });

  it("applies the user's overrides: title, model, portrait and read-only tools, with a new hash (#181)", () => {
    const { cwd, home } = folders();
    write(
      join(cwd, '.claude', 'skills', 'security', 'SKILL.md'),
      skill('name: security\nibitsa-councillor: true'),
    );
    const plain = new CouncillorSkills({ cwd, home, pluginDirs: [] }).list()[0];
    const extended = new CouncillorSkills({
      cwd,
      home,
      pluginDirs: [],
      overrides: {
        security: {
          title: 'Guardian',
          model: 'opus',
          portrait: 'councillor.elder',
          tools: ['Read', 'Bash', 'WebSearch'],
        },
        nobody: { title: 'Ghost' },
      },
    }).list();
    expect(extended).toEqual([
      {
        ...plain,
        title: 'Guardian',
        model: 'opus',
        portrait: 'councillor.elder',
        tools: ['Read', 'WebSearch'],
        hash: expect.stringMatching(/^[0-9a-f]{12}$/),
      },
    ]);
    expect(extended[0]?.hash).not.toBe(plain?.hash);
    // Blank fields and tools that aren't read-only leave the skill's own.
    const blank = new CouncillorSkills({
      cwd,
      home,
      pluginDirs: [],
      overrides: { security: { title: '  ', tools: ['Bash'] } },
    }).list()[0];
    expect(blank).toMatchObject({ title: plain?.title, tools: plain?.tools });
  });

  it('reads overrides from the adapter, through CouncillorSkills.of (#181)', async () => {
    const { cwd, home } = folders();
    write(
      join(cwd, '.claude', 'skills', 'security', 'SKILL.md'),
      skill('name: security\nibitsa-councillor: true'),
    );
    const adapter = new ClaudeAdapter({
      env: () => ({}),
      home,
      councillorOverrides: () => ({ security: { title: 'Guardian' } }),
    });
    expect((await adapter.listCouncillors({ cwd }))[0]?.title).toBe('Guardian');
  });

  it('names the agent a councillor reviews on, Claude being the default (#201)', () => {
    const { cwd, home } = folders();
    write(
      join(cwd, '.claude', 'skills', 'security', 'SKILL.md'),
      skill('name: security\nibitsa-councillor: true'),
    );
    const agentOf = (agent: string) =>
      new CouncillorSkills({
        cwd,
        home,
        pluginDirs: [],
        overrides: { security: { agent } },
      }).list()[0]?.agent;
    expect(agentOf(' codex ')).toBe('codex');
    expect(agentOf('claude')).toBeUndefined();
    expect(agentOf('  ')).toBeUndefined();
  });

  it("gives a reviewer on another agent the councillor's guidance, or null without a skill (#201)", () => {
    const { cwd, home } = folders();
    write(
      join(cwd, '.claude', 'skills', 'security', 'SKILL.md'),
      skill(
        'name: security\nibitsa-councillor: true\nibitsa-title: Guardian',
        'Watches trust boundaries.\n## Planning\nPlan.\n## Review\nLook for injection.\n',
      ),
    );
    const adapter = new ClaudeAdapter({ env: () => ({}), home });
    const found = adapter.reviewGuidance({ cwd, councillorId: 'security' });
    expect(found?.title).toBe('Guardian');
    expect(found?.guidance).toContain('Look for injection.');
    expect(adapter.reviewGuidance({ cwd, councillorId: 'nobody' })).toBeNull();
  });

  it('lets the project replace the user, and the user replace a built-in, by id', () => {
    const { cwd, home, plugin } = folders();
    for (const [root, source] of [
      [join(plugin, 'skills'), 'builtin'],
      [join(home, '.claude', 'skills'), 'user'],
      [join(cwd, '.claude', 'skills'), 'project'],
    ] as const) {
      write(
        join(root, 'tester', 'SKILL.md'),
        skill(`name: tester\ndescription: ${source}\nibitsa-councillor: true`),
      );
    }
    const list = () => new CouncillorSkills({ cwd, home, pluginDirs: [plugin] }).list();
    expect(list().map((c) => [c.skill, c.source, c.description])).toEqual([
      ['tester', 'project', 'project'],
    ]);
    rmSync(join(cwd, '.claude'), { recursive: true });
    expect(list().map((c) => c.source)).toEqual(['user']);
    rmSync(join(home, '.claude'), { recursive: true });
    expect(list().map((c) => c.source)).toEqual(['builtin']);
  });

  it('keeps only read-only tools, falling back to the defaults', () => {
    const { cwd, home } = folders();
    const tools = (field: string) => {
      write(
        join(cwd, '.claude', 'skills', 'a', 'SKILL.md'),
        skill(`name: a\nibitsa-councillor: true\nibitsa-tools: ${field}`),
      );
      return new CouncillorSkills({ cwd, home, pluginDirs: [] }).list()[0]?.tools;
    };
    expect(tools('[Read, "WebSearch", Read]')).toEqual(['Read', 'WebSearch']);
    expect(tools('Grep, Bash, Edit')).toEqual(['Grep']);
    expect(tools('[Write, Bash]')).toEqual(['Read', 'Grep', 'Glob']);
  });

  it('names a councillor after its folder without a name, titles it, and treats a plain body as planning', () => {
    const { cwd, home } = folders();
    write(
      join(cwd, '.claude', 'skills', 'api-design', 'SKILL.md'),
      skill('ibitsa-councillor: true', 'Think about the API.\n'),
    );
    expect(new CouncillorSkills({ cwd, home, pluginDirs: [] }).list()[0]).toMatchObject({
      id: 'api-design',
      title: 'Api design',
      modes: { planning: true, review: false },
    });
  });

  it("gives a review its councillor's opening and `## Review` section, without the planning one (#138)", () => {
    const { cwd, home } = folders();
    write(
      join(cwd, '.claude', 'skills', 'security', 'SKILL.md'),
      skill(
        'name: security\nibitsa-councillor: true',
        'You guard secrets.\n\n## Planning\nThreat model.\n\n## Review\nCheck inputs.\n',
      ),
    );
    write(
      join(cwd, '.claude', 'skills', 'plain', 'SKILL.md'),
      skill('ibitsa-councillor: true', 'Only an opening.\n'),
    );
    const skills = new CouncillorSkills({ cwd, home, pluginDirs: [] });
    expect(skills.review('security')?.guidance).toBe(
      'You guard secrets.\n\n## Review\nCheck inputs.',
    );
    expect(skills.review('plain')?.guidance).toBe('Only an opening.');
    expect(skills.review('nobody')).toBeNull();
  });

  it('gives a changed skill file a new hash', () => {
    const { cwd, home } = folders();
    const path = join(cwd, '.claude', 'skills', 'a', 'SKILL.md');
    const hash = () => new CouncillorSkills({ cwd, home, pluginDirs: [] }).list()[0]?.hash;
    write(path, skill('name: a\nibitsa-councillor: true'));
    const before = hash();
    expect(hash()).toBe(before);
    write(path, skill('name: a\nibitsa-councillor: true', '## Planning\nLook harder.\n'));
    expect(hash()).not.toBe(before);
  });

  it('is what the adapter lists, with the plugin folders it was given', async () => {
    const { cwd, home, plugin } = folders();
    write(
      join(plugin, 'skills', 'security', 'SKILL.md'),
      skill('name: security\nibitsa-councillor: true'),
    );
    const adapter = new ClaudeAdapter({ env: () => ({}), home, pluginDirs: () => [plugin] });
    expect((await adapter.listCouncillors({ cwd })).map((c) => c.skill)).toEqual([
      'ibitsa:security',
    ]);
  });
});
