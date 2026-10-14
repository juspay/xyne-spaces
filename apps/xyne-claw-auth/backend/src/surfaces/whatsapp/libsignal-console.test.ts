import { describe, expect, it, vi } from "vitest";
import { redactLibsignalSessionLogs } from "./libsignal-console.js";

class SessionEntry {
  currentRatchet = { rootKey: Buffer.from("root"), ephemeralKeyPair: { privKey: Buffer.from("priv") } };
}

describe("redactLibsignalSessionLogs", () => {
  it("replaces SessionEntry arguments and leaves the rest", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    redactLibsignalSessionLogs();
    redactLibsignalSessionLogs(); // idempotent

    console.info("Closing session:", new SessionEntry());
    console.warn("Session already open", { id: 1 });

    expect(info).toHaveBeenCalledWith("Closing session:", "[SessionEntry]");
    expect(warn).toHaveBeenCalledWith("Session already open", { id: 1 });
  });
});
