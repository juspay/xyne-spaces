import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Point the session store at a temp dataDir BEFORE importing it (config.ts
// reads env at module load).
const dataDir = mkdtempSync(path.join(tmpdir(), "claw-freshness-"));
process.env["XYNE_CLAW_DATA_DIR"] = dataDir;

const { ensureFreshSession, sessionDir } = await import("../src/session-store.js");

// In the test environment there is no GKE metadata server and no S2S key, so:
//   - gcsSessionUpdatedAt() → null  (freshness unknown)
//   - restoreSessionFromArchive() → false (no archive reachable)
// That makes "fresh-start" and "local-unverified" the locally-testable
// decisions; the GCS-dependent ones (restored-stale etc.) are verified in
// prod via the `[session-store] freshness` log line during chaos testing.

function writeSessionFile(conversationId: string, rel: string, content: string): void {
  const dir = sessionDir(conversationId);
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), content);
}

describe("ensureFreshSession", () => {
  beforeEach(() => {
    delete process.env["XYNE_CLAW_S2S_KEY"];
  });

  it("returns fresh-start when no local dir and no archive", async () => {
    expect(await ensureFreshSession(`conv-${Math.random().toString(36).slice(2)}`)).toBe("fresh-start");
  });

  it("treats an EMPTY local dir as missing (fresh-start), not as a resumable session", async () => {
    const id = `conv-empty-${Math.random().toString(36).slice(2)}`;
    mkdirSync(sessionDir(id), { recursive: true });
    expect(await ensureFreshSession(id)).toBe("fresh-start");
    // The empty dir must be gone so SessionManager starts a genuinely new session.
    expect(existsSync(sessionDir(id))).toBe(false);
  });

  it("keeps the local copy untouched when GCS freshness is unknown (local-unverified)", async () => {
    const id = `conv-local-${Math.random().toString(36).slice(2)}`;
    writeSessionFile(id, "session.jsonl", '{"turn":1}\n');
    expect(await ensureFreshSession(id)).toBe("local-unverified");
    expect(readFileSync(path.join(sessionDir(id), "session.jsonl"), "utf8")).toBe('{"turn":1}\n');
  });
});
