import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSpacesEncryptionKeyRing } from "./spaces-encryption-key-ring.js";

const LEGACY = crypto.randomBytes(32).toString("hex");

const K1 = crypto.randomBytes(32).toString("hex");

const K2 = crypto.randomBytes(32).toString("hex");

describe("parseSpacesEncryptionKeyRing", () => {
  it("loads the legacy key under the legacy id", () => {
    const ring = parseSpacesEncryptionKeyRing(LEGACY, undefined);

    expect(ring.get("legacy")?.toString("hex")).toBe(LEGACY);
  });

  it("loads every entry in the ordered array", () => {
    const ring = parseSpacesEncryptionKeyRing(
      LEGACY,
      JSON.stringify([
        {
          id: "k1",
          key: K1,
        },
        {
          id: "k2",
          key: K2,
        },
      ]),
    );

    expect(ring.get("legacy")?.toString("hex")).toBe(LEGACY);

    expect(ring.get("k1")?.toString("hex")).toBe(K1);

    expect(ring.get("k2")?.toString("hex")).toBe(K2);
  });

  it("accepts an empty ordered array", () => {
    const ring = parseSpacesEncryptionKeyRing(LEGACY, "[]");

    expect(ring.size).toBe(1);
    expect(ring.has("legacy")).toBe(true);
  });

  it("rejects the previous object format", () => {
    expect(() =>
      parseSpacesEncryptionKeyRing(
        LEGACY,
        JSON.stringify({
          k1: K1,
        }),
      ),
    ).toThrow(/ordered JSON array/);
  });

  it("rejects duplicate key ids", () => {
    expect(() =>
      parseSpacesEncryptionKeyRing(
        LEGACY,
        JSON.stringify([
          {
            id: "k1",
            key: K1,
          },
          {
            id: "k1",
            key: K2,
          },
        ]),
      ),
    ).toThrow(/Duplicate Spaces encryption key id/);
  });

  it("rejects the reserved legacy id", () => {
    expect(() =>
      parseSpacesEncryptionKeyRing(
        LEGACY,
        JSON.stringify([
          {
            id: "legacy",
            key: K1,
          },
        ]),
      ),
    ).toThrow(/Invalid key id/);
  });

  it("rejects the reserved version tag", () => {
    expect(() =>
      parseSpacesEncryptionKeyRing(
        LEGACY,
        JSON.stringify([
          {
            id: "v2",
            key: K1,
          },
        ]),
      ),
    ).toThrow(/Invalid key id/);
  });

  it("rejects key ids containing a colon", () => {
    expect(() =>
      parseSpacesEncryptionKeyRing(
        LEGACY,
        JSON.stringify([
          {
            id: "bad:key",
            key: K1,
          },
        ]),
      ),
    ).toThrow(/Invalid key id/);
  });

  it("rejects incorrectly sized keys", () => {
    expect(() =>
      parseSpacesEncryptionKeyRing(
        LEGACY,
        JSON.stringify([
          {
            id: "bad",
            key: "abcd",
          },
        ]),
      ),
    ).toThrow(/must be 32 bytes/);
  });

  it("rejects an invalid legacy key", () => {
    expect(() => parseSpacesEncryptionKeyRing("abcd", undefined)).toThrow(/SPACES_ENCRYPTION_KEY/);
  });
});
