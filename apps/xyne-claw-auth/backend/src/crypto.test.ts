import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";

const LEGACY_HEX = "a1".repeat(32);
const K1_HEX = "b2".repeat(32);
const K2_HEX = "c3".repeat(32);
const PLAINTEXT = "smoke-plaintext";

function cbcBlob(
  keyHex: string,
  plaintext: string,
  keyId?: string,
): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const base = `${iv.toString("hex")}:${encrypted.toString("hex")}`;
  return keyId ? `v2:${keyId}:${base}` : base;
}

async function freshModules() {
  vi.resetModules();
  return {
    config: await import("./spaces-encryption-key-ring-config.js"),
    crypto: await import("./crypto.js"),
  };
}

describe("spaces encryption (config + crypto)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("decrypts legacy ciphertext with only SPACES_ENCRYPTION_KEY semantics", async () => {
    const { config, crypto } = await freshModules();

    expect(
      crypto.decryptSpacesCbc(
        cbcBlob(LEGACY_HEX, PLAINTEXT),
        Buffer.from(LEGACY_HEX, "hex"),
      ),
    ).toBe(PLAINTEXT);

    const loaded = config.loadSpacesEncryptionRuntimeConfig();
    expect(loaded.mode).toBe("legacy");
    expect(loaded.reason).toBe("keyring_not_configured");
  });

  it("invalid ring falls back without crashing and keeps legacy reads", async () => {
    vi.stubEnv("SPACES_ENCRYPTION_KEYS", "not-json");

    const warnSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const { config, crypto } = await freshModules();
    const loaded = config.loadSpacesEncryptionRuntimeConfig();

    expect(loaded.mode).toBe("legacy");
    expect(loaded.reason).toBe("keyring_json_invalid");

    expect(
      crypto.decryptSpacesCbc(
        cbcBlob(LEGACY_HEX, PLAINTEXT),
        Buffer.from(LEGACY_HEX, "hex"),
      ),
    ).toBe(PLAINTEXT);

    // V2 ciphertext fails cleanly in legacy fallback.
    expect(() =>
      crypto.decryptSpacesCbc(
        cbcBlob(K1_HEX, PLAINTEXT, "k1"),
        Buffer.from(LEGACY_HEX, "hex"),
      ),
    ).toThrowError();

    // The fallback may log at most one sanitized line and it
    // must not contain the raw malformed value.
    const lines = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    expect(lines).not.toContain("not-json");
    warnSpy.mockRestore();
  });

  it("non-array JSON is a validation failure, not a JSON failure", async () => {
    vi.stubEnv("SPACES_ENCRYPTION_KEYS", "{}");
    const { config } = await freshModules();
    expect(config.loadSpacesEncryptionRuntimeConfig().reason).toBe(
      "keyring_validation_failed",
    );
  });

  it("decrypts v2 ciphertext with a valid matching ring", async () => {
    vi.stubEnv(
      "SPACES_ENCRYPTION_KEYS",
      JSON.stringify([
        { id: "k1", key: K1_HEX },
        { id: "k2", key: K2_HEX },
      ]),
    );

    const { config, crypto } = await freshModules();
    expect(config.loadSpacesEncryptionRuntimeConfig().mode).toBe(
      "keyring-read",
    );

    // Both entries in the ring remain readable: old k1 data and
    // new k2 data.
    expect(
      crypto.decryptSpacesCbc(
        cbcBlob(K1_HEX, "k1-era-secret", "k1"),
        Buffer.from(LEGACY_HEX, "hex"),
      ),
    ).toBe("k1-era-secret");

    expect(
      crypto.decryptSpacesCbc(
        cbcBlob(K2_HEX, "k2-era-secret", "k2"),
        Buffer.from(LEGACY_HEX, "hex"),
      ),
    ).toBe("k2-era-secret");

    // Legacy data is untouched.
    expect(
      crypto.decryptSpacesCbc(
        cbcBlob(LEGACY_HEX, "legacy-secret"),
        Buffer.from(LEGACY_HEX, "hex"),
      ),
    ).toBe("legacy-secret");
  });

  it("an unknown v2 key ID fails cleanly without leaking secrets", async () => {
    vi.stubEnv(
      "SPACES_ENCRYPTION_KEYS",
      JSON.stringify([{ id: "k1", key: K1_HEX }]),
    );

    const { crypto } = await freshModules();

    let caught: unknown;
    try {
      crypto.decryptSpacesCbc(
        cbcBlob(LEGACY_HEX, "inner-secret", "ghost"),
        Buffer.from(LEGACY_HEX, "hex"),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    const message =
      caught instanceof Error ? caught.message : String(caught);
    for (const raw of [LEGACY_HEX, K1_HEX, "inner-secret"]) {
      expect(message).not.toContain(raw);
    }
  });
});
