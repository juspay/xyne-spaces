import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Local test transcript for artifact testing.
 *
 * Drop your transcript into `./transcripts/default.txt` (or `.md`). Its content
 * IS the transcript — it's read verbatim and, whenever present, is used as the
 * call transcript for both artifact generation and the UI. Delete/empty the
 * file to fall back to the real GCS transcript.
 *
 * Write it as `[MM:SS] Speaker: text` lines (that's the format the app uses, and
 * what makes citations work), e.g.:
 *
 *     [00:00] Ishaan Rawat: First thing said.
 *     [00:15] Priya Sharma: Their reply.
 *
 * See apps/backend/TEST_TRANSCRIPTS.md.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANSCRIPTS_DIR = path.join(__dirname, 'transcripts');

/** Read a named transcript file and return its contents; null if missing/empty. */
export async function loadTestTranscript(name: string): Promise<string | null> {
  for (const ext of ['.txt', '.md']) {
    try {
      const content = (await fs.readFile(path.join(TRANSCRIPTS_DIR, `${name}${ext}`), 'utf-8')).trim();
      if (content) return content;
    } catch {
      // try next extension
    }
  }
  return null;
}
