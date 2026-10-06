// Prints each package's unit-test coverage as a Markdown table, for the CI run summary. The floor is a
// fixed 85/85/85/80 per package (vitest.config.ts); this keeps the actual numbers in view on every PR.
import { readFileSync } from 'node:fs';

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const metrics = ['lines', 'statements', 'functions', 'branches'];
const totals = new Map();
for (const [file, data] of Object.entries(summary)) {
  const match = file.match(/packages\/(adapters\/[^/]+|[^/]+)\//);
  if (!match) continue;
  const t = totals.get(match[1]) ?? Object.fromEntries(metrics.map((m) => [m, [0, 0]]));
  for (const m of metrics) {
    t[m][0] += data[m].covered;
    t[m][1] += data[m].total;
  }
  totals.set(match[1], t);
}
const pct = ([covered, total]) => (total === 0 ? '100.0' : ((100 * covered) / total).toFixed(1));
console.log('### Unit test coverage (floor 85 / 85 / 85 / 80 per package)\n');
console.log(`| Package | ${metrics.join(' | ')} |`);
console.log(`|---|${metrics.map(() => '---:').join('|')}|`);
for (const [name, t] of [...totals].sort()) {
  console.log(`| ${name} | ${metrics.map((m) => pct(t[m])).join(' | ')} |`);
}
