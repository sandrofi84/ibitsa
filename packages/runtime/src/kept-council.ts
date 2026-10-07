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

  /** `from` names the campaign whose council it was (#168), for the elder and the convene form. */
  keep({ sessionId, from }: { sessionId: string; from: string }): void {
    mkdirSync(join(this.file, '..'), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify({ sessionId, from })}\n`);
  }

  /** The campaign the kept context comes from (#168); null when nothing is kept. */
  keptFrom(): string | null {
    if (!this.peek()) return null;
    try {
      const { from } = JSON.parse(readFileSync(this.file, 'utf8')) as { from?: unknown };
      return typeof from === 'string' ? from : 'an earlier campaign';
    } catch {
      return null;
    }
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
