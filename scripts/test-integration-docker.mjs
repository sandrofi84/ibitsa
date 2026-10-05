// Runs the VS Code integration suites in a Linux container under xvfb, as CI does (#39), so no VS Code
// window opens on your desktop. Needs Docker. Extra arguments go to vscode-test, e.g. `-- --label wiring`.
// The working tree is copied in (uncommitted changes included); node_modules, the pnpm store and VS Code
// downloads live in the container and in named volumes, so host binaries never mix with Linux ones.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const image = 'ibitsa-integration';
const args = process.argv.slice(2).filter((a) => a !== '--');

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
  if (result.error) {
    console.error(
      `Could not run ${command}: ${result.error.message}. Is Docker installed and running?`,
    );
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('docker', [
  'build',
  '-t',
  image,
  '-f',
  `${root}scripts/integration.Dockerfile`,
  `${root}scripts`,
]);

const quoted = args.map((a) => `'${a.replaceAll("'", "'\\''")}'`).join(' ');
const inside = [
  'set -e',
  'tar -C /src --exclude=node_modules --exclude=dist --exclude=.vscode-test --exclude=.git --exclude=coverage --exclude=test-results -cf - . | tar -xf - -C /work',
  'pnpm install --frozen-lockfile',
  'pnpm -r build',
  'cd packages/extension',
  `xvfb-run -a -s "-screen 0 1920x1080x24" pnpm test:integration ${quoted}`,
].join('\n');

run('docker', [
  'run',
  '--rm',
  '--init',
  '-v',
  `${root}:/src:ro`,
  '-v',
  'ibitsa-pnpm-store:/pnpm-store',
  '-v',
  'ibitsa-vscode-test:/work/packages/extension/.vscode-test',
  image,
  'bash',
  '-c',
  inside,
]);
