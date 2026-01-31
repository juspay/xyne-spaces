/**
 * Query Hash Utility
 *
 * Generates consistent hashes from query name and arguments for cache lookup.
 * Uses JSON serialization with sorted keys to ensure deterministic hashing.
 */

import type { ReadonlyJSONValue } from '@rocicorp/zero';
import { h32 } from 'xxhashjs';

function hashString(str: string): string {
  const hash = h32(str, 0).toString(36);
  return hash;
}

/**
 * Sort object keys recursively to ensure consistent serialization
 */
function sortObjectKeys(obj: ReadonlyJSONValue): ReadonlyJSONValue {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }

  if (typeof obj === 'object' && obj.constructor === Object) {
    const sorted: Record<string, ReadonlyJSONValue> = {};
    Object.entries(obj)
      .sort()
      .forEach(([key, value]) => {
        if (value !== undefined) {
          sorted[key] = sortObjectKeys(value);
        }
      });
    return sorted;
  }

  return obj;
}

/**
 * Generate a hash from query name and arguments
 *
 * @param name - The query name (from query.query.queryName)
 * @param args - The query arguments
 * @param options - Optional query options
 * @returns A deterministic hash string, or null if hashing fails
 */
export function generateQueryHash(
  name: string,
  args: ReadonlyJSONValue | undefined,
): string | null {
  try {
    const hashInput = {
      name,
      args: args ? sortObjectKeys(args) : undefined,
    };

    // Serialize to JSON
    const serialized = JSON.stringify(hashInput);

    // Generate hash
    return hashString(serialized);
  } catch (error) {
    // Return null to disable caching if serialization fails
    console.warn('Failed to serialize query for hashing, caching disabled:', error);
    return null;
  }
}
