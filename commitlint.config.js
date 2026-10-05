// Conventional Commits (https://www.conventionalcommits.org). The scope is optional;
// when present it names a package or a repo-level area.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        // packages
        'protocol',
        'core',
        'runtime',
        'agent-fake',
        'agent-claude-sdk',
        'game',
        'extension',
        'assets',
        // repo-level
        'spec',
        'adr',
        'glossary',
        'ci',
        'deps',
        'repo',
      ],
    ],
  },
};
