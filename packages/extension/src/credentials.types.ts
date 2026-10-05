/** The part of VS Code's SecretStorage the credential lookup needs. */
export interface SecretReader {
  get(key: string): PromiseLike<string | undefined>;
}

/** Where the agent's credentials come from (spec §11.6). */
export type Credentials =
  | { source: 'secret' | 'environment'; apiKey: string }
  /** Bedrock, Vertex or Foundry, configured through the environment and passed through untouched. */
  | { source: 'provider'; provider: 'bedrock' | 'vertex' | 'foundry' }
  | { source: 'none' };
