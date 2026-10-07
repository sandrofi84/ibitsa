import type { IslandView } from '@ibitsa/protocol';
import type { GameClient } from './client';
import type { PullRequestAction } from './pull-requests.types';

/** What the PR card needs: the island, and what to do when a button is pressed. */
export interface PullRequestCardOptions {
  island: IslandView;
  onAction: (id: PullRequestAction['id']) => void;
}

/** The preview form before opening a PR (§5.6). */
export interface PullRequestPreview {
  /** Starts from the island's `pullRequestDraft`. */
  open(islandId: string): void;
  close(): void;
  /** The island it's open for, or null. */
  shown(): string | null;
}

/** A panel that shows one island's PR card and follows snapshots (opened from its badge). */
export interface PullRequestPanel {
  open(islandId: string): void;
  close(): void;
  shown(): string | null;
}

/** A short summary of an island's PR, shown while the pointer is over its badge. */
export interface PullRequestHover {
  show(at: { islandId: string; x: number; y: number }): void;
  hide(): void;
}

/** What a card's buttons act through: the client, and the preview its Open PR opens. */
export interface PullRequestActions {
  client: GameClient;
  preview: PullRequestPreview;
}
