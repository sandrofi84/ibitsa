// File conventions (AGENTS.md):
//   foo.types.ts   types only (type aliases, interfaces, type-only imports and re-exports)
//   foo.schema.ts  Valibot schemas, the types derived from them, and their helper constants
//   other .ts      no type or interface declarations (barrels may re-export types)
// Tests (*.test.ts, *.e2e.ts), ambient declarations (*.d.ts) and tool configs are exempt.
// Checks top-level lines only; the code is Biome-formatted, so top level means column 0.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const exempt = /(\.test\.ts|\.e2e\.ts|\.d\.ts|\.config\.ts)$/;

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      [
        'node_modules',
        '.tsbuild',
        'dist',
        'dist-standalone',
        '.vscode-test',
        'default-pack',
      ].includes(entry.name)
    ) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (entry.name.endsWith('.ts') && !exempt.test(entry.name)) yield path;
  }
}

const TYPE_DECL = /^(export )?(type|interface) \w/;
const VALUE_DECL = /^(export )?(default |async )?(const|let|var|function|class|enum) /;
const VALUE_REEXPORT = /^export \{(?! type)|^export \* from/;
const problems = [];

for (const file of sourceFiles(join(root, 'packages'))) {
  const rel = relative(root, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (rel.endsWith('.types.ts')) {
      if (VALUE_DECL.test(line) || VALUE_REEXPORT.test(line) || /^import (?!type )/.test(line)) {
        problems.push(`${at}  .types.ts files hold types only: ${line.trim()}`);
      }
    } else if (rel.endsWith('.schema.ts')) {
      if (/^(export )?(default |async )?(function|class|let|var|enum) /.test(line)) {
        problems.push(`${at}  .schema.ts files hold schemas and their types only: ${line.trim()}`);
      }
    } else if (TYPE_DECL.test(line)) {
      problems.push(
        `${at}  move this type to ${rel.replace(/\.ts$/, '.types.ts')}: ${line.trim()}`,
      );
    }
  });
}

if (problems.length > 0) {
  console.error(`File convention problems (see AGENTS.md):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('File conventions: ok');
