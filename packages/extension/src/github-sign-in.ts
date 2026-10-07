import * as vscode from 'vscode';

/**
 * A GitHub token from VS Code's built-in GitHub sign-in, `repo` scope (spec §5.6, M6). Asked for only
 * when a PR action needs it; polling uses the session silently and never prompts. Null when the user
 * isn't signed in or cancels. The token goes to the git host and nowhere else: never core or the log.
 */
export async function githubToken({
  interactive,
}: {
  interactive: boolean;
}): Promise<string | null> {
  try {
    const session = await vscode.authentication.getSession(
      'github',
      ['repo'],
      interactive ? { createIfNone: true } : { silent: true },
    );
    return session?.accessToken ?? null;
  } catch {
    return null;
  }
}
