import { describe, expect, it } from "vitest";
import { createLazySpacesEncryptionKeyRing } from "./spaces-encryption-key-ring.js";

describe("lazy Spaces encryption key ring", () => {
  it("does not validate a malformed key until first use", () => {
    let loadRing: (() => ReadonlyMap<string, Buffer>) | undefined;

    expect(() => {
      loadRing = createLazySpacesEncryptionKeyRing("not-a-valid-64-character-hex-key", undefined);
    }).not.toThrow();

    expect(loadRing).toBeDefined();
    expect(() => loadRing?.()).toThrow();
  });

  it("loads a valid legacy key on first use", () => {
    const legacyKey = "11".repeat(32);

    const loadRing = createLazySpacesEncryptionKeyRing(legacyKey, undefined);

    const ring = loadRing();

    expect(ring.get("legacy")?.toString("hex")).toBe(legacyKey);
  });

  it("caches a successfully parsed key ring", () => {
    const loadRing = createLazySpacesEncryptionKeyRing("22".repeat(32), undefined);

    const first = loadRing();
    const second = loadRing();

    expect(second).toBe(first);
  });
});
