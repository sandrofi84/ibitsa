// Creates the sample repo for the M1 demo (#40): `node scripts/demo-repo.mjs [dir]` (default ~/ibitsa-demo).
// It is built so a run reaches every step of the checklist: a test that already fails (the hurt cue),
// a quest that asks the hero to put a question to you, and a note outside the worktree, which always
// asks permission (spec §11.6). Tests run with `node --test`; nothing to install.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? join(homedir(), 'ibitsa-demo'));
if (existsSync(dir)) {
  console.error(`${dir} already exists; remove it or pass another folder.`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

const files = {
  'package.json': `${JSON.stringify(
    { name: 'recipes', private: true, type: 'module', scripts: { test: 'node --test' } },
    null,
    2,
  )}\n`,
  'slug.mjs': `export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
`,
  'slug.test.mjs': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from './slug.mjs';

test('joins words with dashes', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('drops punctuation', () => {
  assert.equal(slugify('Ready, set... go!'), 'ready-set-go');
});

test('strips accents', () => {
  assert.equal(slugify('Crème Brûlée'), 'creme-brulee');
});
`,
  'CLAUDE.md': `# recipes

- Run the tests with \`npm test\` before changing anything, and again after.
- Edit files with the Edit tool, not shell commands.
- Commit with a conventional commit message.
`,
};
for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);

const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
git('init', '-q', '-b', 'main');
git('add', '.');
git('-c', 'user.name=Ibitsa demo', '-c', 'user.email=demo@example.com', 'commit', '-qm', 'init');

const notes = join(dir, '..', 'ibitsa-demo-notes.md');
console.log(`Demo repo ready: ${dir}

Open it with "Run Ibitsa" (F5 in the Ibitsa repo), then File > Open Folder in the new window.
Quest description to paste into "Ibitsa: New Quest":

Make slugify strip accents
The "strips accents" test fails. Before you fix it, use AskUserQuestion to ask me whether
underscores should also become dashes (two options). Then fix slugify, add a test for my answer,
and append one line describing the change to ${notes}. Commit, then submit.
`);
