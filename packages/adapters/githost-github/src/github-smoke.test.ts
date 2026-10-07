import { describe, expect, it } from 'vitest';
import { GitHubHost } from './github-host';

// A live check of GitHub as the git host (#152), on a private sandbox repository. It creates a branch
// with one commit, opens a draft PR, polls its badge, marks it ready, then closes the PR and deletes
// the branch. It changes a real repository, so it only runs on request:
//   IBITSA_SMOKE=1 GITHUB_TOKEN=$(gh auth token) pnpm exec vitest run --project @ibitsa/githost-github github-smoke
// IBITSA_SANDBOX picks another repository (owner/name).
const SANDBOX = process.env.IBITSA_SANDBOX ?? 'sandrofi84/ibitsa-sandbox';
const token = process.env.GITHUB_TOKEN ?? '';

/** Setup and cleanup the host has no call for. */
async function api({ method, path, body }: { method: string; path: string; body?: unknown }) {
  const response = await fetch(`https://api.github.com/repos/${SANDBOX}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'ibitsa-smoke',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

describe.skipIf(process.env.IBITSA_SMOKE !== '1' || token === '')(
  'live GitHub host (smoke)',
  () => {
    it('opens a draft PR, polls it, marks it ready, and cleans up', async () => {
      const host = new GitHubHost({ token: async () => token });
      const remoteUrl = `https://github.com/${SANDBOX}.git`;
      const repo = (await api({ method: 'GET', path: '' })) as { default_branch: string };
      const base = repo.default_branch;
      const head = `ibitsa/smoke-${Date.now()}`;
      const tip = (await api({ method: 'GET', path: `/git/ref/heads/${base}` })) as {
        object: { sha: string };
      };
      await api({
        method: 'POST',
        path: '/git/refs',
        body: { ref: `refs/heads/${head}`, sha: tip.object.sha },
      });
      let number: number | null = null;
      try {
        await api({
          method: 'PUT',
          path: `/contents/smoke/${head.replace('/', '-')}.md`,
          body: { message: 'smoke: a change to review', content: btoa('smoke\n'), branch: head },
        });
        const opened = await host.openPullRequest({
          remoteUrl,
          head,
          base,
          title: 'Ibitsa smoke test',
          body: 'Opened and closed by the githost-github smoke test.',
          draft: true,
        });
        number = opened.number;
        expect(opened.state).toBe('draft');
        expect(await host.poll({ remoteUrl, numbers: [opened.number] })).toEqual([
          { number: opened.number, state: 'draft' },
        ]);
        await host.markReady({ remoteUrl, number: opened.number });
        const [polled] = await host.poll({ remoteUrl, numbers: [opened.number] });
        expect(polled?.state).not.toBe('draft');
        expect(await host.reviewComments({ remoteUrl, number: opened.number })).toEqual([]);
      } finally {
        if (number !== null)
          await api({ method: 'PATCH', path: `/pulls/${number}`, body: { state: 'closed' } });
        await api({ method: 'DELETE', path: `/git/refs/heads/${head}` });
      }
    }, 120_000);
  },
);
