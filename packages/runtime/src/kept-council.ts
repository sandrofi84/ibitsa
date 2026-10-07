import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The council's lead session kept for the next campaign (spec §4.9, #167): Keep and Compact store its
 * id in workspace storage, and the next campaign's first sitting takes it, once. Empty forgets it.
 */
export class KeptCouncil {
  private readonly file: string;

  constructor(storageDir: string) {
    this.file = join(storageDir, 'council.json');
  }

  keep(sessionId: string): void {
    mkdirSync(join(this.file, '..'), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify({ sessionId })}\n`);
  }

  /** The kept session's id, if any, without forgetting it (the elder may mention it, #168). */
  peek(): string | null {
    if (!existsSync(this.file)) return null;
    try {
      const { sessionId } = JSON.parse(readFileSync(this.file, 'utf8')) as { sessionId?: unknown };
      return typeof sessionId === 'string' ? sessionId : null;
    } catch {
      return null;
    }
  }

  /** The kept session's id for a sitting to resume, then forgotten: it's resumed once. */
  take(): string | null {
    const sessionId = this.peek();
    this.forget();
    return sessionId;
  }

  forget(): void {
    rmSync(this.file, { force: true });
  }
}
