import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSpacesCbc, type SpacesKeyRing } from "./crypto.js";

// These fixtures reproduce what xyne-spaces' encryptionService actually writes,
// rather than round-tripping through this file's own code. If Spaces changes its
// output format, these break here — which is the point, because the two services
// agree only by convention and nothing else would notice the drift.
function spacesEncrypt(plaintext: string, key: Buffer, keyId?: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const ct = cipher.update(plaintext, "utf8", "hex") + cipher.final("hex");
  return keyId ? `v2:${keyId}:${iv.toString("hex")}:${ct}` : `${iv.toString("hex")}:${ct}`;
}

const LEGACY = Buffer.alloc(32, 1);
const K1 = Buffer.alloc(32, 2);

function ring(entries: Array<[string, Buffer]>): SpacesKeyRing {
  return new Map(entries);
}

describe("decryptSpacesCbc", () => {
  const full = ring([
    ["legacy", LEGACY],
    ["k1", K1],
  ]);

  it("reads a legacy iv:ct blob under the legacy key", () => {
    const blob = spacesEncrypt("s3cr3t", LEGACY);
    expect(decryptSpacesCbc(blob, full)).toBe("s3cr3t");
  });

  it("reads a versioned blob written under the active key", () => {
    const blob = spacesEncrypt("s3cr3t", K1, "k1");
    expect(decryptSpacesCbc(blob, full)).toBe("s3cr3t");
  });

  // The whole point of the key id: mid-rotation both shapes are on disk at once.
  it("reads both shapes while a rotation is draining", () => {
    expect(decryptSpacesCbc(spacesEncrypt("old", LEGACY), full)).toBe("old");
    expect(decryptSpacesCbc(spacesEncrypt("new", K1, "k1"), full)).toBe("new");
  });

  it("reads a versioned blob that names the legacy key explicitly", () => {
    const blob = spacesEncrypt("s3cr3t", LEGACY, "legacy");
    expect(decryptSpacesCbc(blob, full)).toBe("s3cr3t");
  });

  // Before this reader understood v2, a versioned blob split on the first colon,
  // producing an empty IV and a "Invalid initialization vector" throw that callers
  // log as "skip this row" — a backfill reporting success while migrating nothing.
  it("names the missing key instead of failing as malformed input", () => {
    const blob = spacesEncrypt("s3cr3t", K1, "k1");
    expect(() => decryptSpacesCbc(blob, ring([["legacy", LEGACY]]))).toThrow(
      /no Spaces key registered for keyId "k1"/,
    );
  });

  it("reports an unconfigured ring rather than silently mis-decrypting", () => {
    const blob = spacesEncrypt("s3cr3t", LEGACY);
    expect(() => decryptSpacesCbc(blob, ring([]))).toThrow(
      /no Spaces key registered for keyId "legacy"/,
    );
  });

  it("rejects a blob with neither shape", () => {
    expect(() => decryptSpacesCbc("nonsense", full)).toThrow(/expected "iv:ct" or "v2:keyId:iv:ct"/);
    expect(() => decryptSpacesCbc("v2:k1:only-three", full)).toThrow(
      /expected "iv:ct" or "v2:keyId:iv:ct"/,
    );
  });

  it("rejects an empty IV or ciphertext", () => {
    expect(() => decryptSpacesCbc(":abcd", full)).toThrow(/empty IV or ciphertext/);
    expect(() => decryptSpacesCbc("abcd:", full)).toThrow(/empty IV or ciphertext/);
  });
});
