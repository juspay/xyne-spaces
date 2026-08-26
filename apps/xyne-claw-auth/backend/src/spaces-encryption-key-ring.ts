const VERSION_TAG = "v2";
const LEGACY_KEY_ID = "legacy";

interface OrderedEncryptionKey {
  id: string;
  key: string;
}

function parseHexKey(
  raw: unknown,
  label: string
): Buffer {
  if (typeof raw !== "string") {
    throw new Error(
      `${label} must be 32 bytes (64 hex characters)`
    );
  }

  const normalized = raw.trim();

  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(
      `${label} must be 32 bytes (64 hex characters)`
    );
  }

  return Buffer.from(normalized, "hex");
}

export function parseSpacesEncryptionKeyRing(
  legacyKey: string | undefined,
  orderedKeysJson: string | undefined,
): ReadonlyMap<string, Buffer> {
  const ring = new Map<string, Buffer>();

  if (legacyKey) {
    ring.set(LEGACY_KEY_ID, parseHexKey(legacyKey, "SPACES_ENCRYPTION_KEY"));
  }

  if (!orderedKeysJson || !orderedKeysJson.trim()) {
    return ring;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(orderedKeysJson);
  } catch {
    throw new Error(
      "SPACES_ENCRYPTION_KEYS must be an ordered JSON array " + "of objects with id and key fields",
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      "SPACES_ENCRYPTION_KEYS must be an ordered JSON array " + "of objects with id and key fields",
    );
  }

  const seen = new Set<string>();

  for (let index = 0; index < parsed.length; index += 1) {
    const value = parsed[index];

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("SPACES_ENCRYPTION_KEYS[" + index + "] must be an object");
    }

    const entry = value as {
      id?: unknown;
      key?: unknown;
    };

    if (typeof entry.id !== "string") {
      throw new Error("SPACES_ENCRYPTION_KEYS[" + index + "].id must be a string");
    }

    const id = entry.id.trim();

    if (!id || id !== entry.id || id.includes(":") || id === VERSION_TAG || id === LEGACY_KEY_ID) {
      throw new Error("Invalid key id at SPACES_ENCRYPTION_KEYS[" + index + "]");
    }

    if (seen.has(id) || ring.has(id)) {
      throw new Error('Duplicate Spaces encryption key id "' + id + '"');
    }

    seen.add(id);

    ring.set(id, parseHexKey(entry.key, "SPACES_ENCRYPTION_KEYS[" + index + "].key"));
  }

  return ring;
}

/**
 * Defer Spaces key validation until a route actually needs the key ring.
 *
 * This prevents an optional, malformed Spaces backfill key from stopping
 * unrelated Claw-auth OAuth, session, and agent-auth functionality at startup.
 * A successful result is cached for the lifetime of the process.
 */
export function createLazySpacesEncryptionKeyRing(
  legacyKey: string | undefined,
  orderedKeys: string | undefined,
): () => ReadonlyMap<string, Buffer> {
  let cached: ReadonlyMap<string, Buffer> | null = null;

  return (): ReadonlyMap<string, Buffer> => {
    if (cached === null) {
      cached = parseSpacesEncryptionKeyRing(legacyKey, orderedKeys);
    }

    return cached;
  };
}
