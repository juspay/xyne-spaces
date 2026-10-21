import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = mkdtempSync(path.join(tmpdir(), "claw-session-exists-"));
process.env["XYNE_CLAW_DATA_DIR"] = root;
process.env["SESSION_ARCHIVE_RETRY_ATTEMPTS"] = "1";
process.env["SESSION_ARCHIVE_RETRY_BACKOFF_MS"] = "0";
process.env["SESSION_ARCHIVE_TIMEOUT_MS"] = "1000";

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("sessionExistsAnywhere", () => {
  it("finds a local session and rejects ids that leave the sessions root", async () => {
    const { sessionExistsAnywhere } = await import("../src/session-store.js");
    mkdirSync(path.join(root, "sessions", "conv-a_agent"), { recursive: true });
    expect(await sessionExistsAnywhere("conv-a_agent")).toBe(true);
    expect(await sessionExistsAnywhere("../outside")).toBe(false);
    expect(await sessionExistsAnywhere("a/b")).toBe(false);
  });
});
