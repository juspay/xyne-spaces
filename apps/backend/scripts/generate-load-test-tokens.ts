#!/usr/bin/env npx tsx

/**
 * Generate tokens.json for zero-load-test.ts
 *
 * Takes a single userId + token and repeats it N times (default 100).
 * The load test will cycle these credentials across all clients.
 *
 * Usage (from backend/):
 *   npx tsx --tsconfig tsconfig.json scripts/generate-load-test-tokens.ts \
 *     --userId <userId> \
 *     --token <jwt> \
 *     --sessionId <sessionId> \
 *     [--count 100] \
 *     [--out tokens.json]
 */

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    userId: { type: "string" },
    token: { type: "string" },
    sessionId: { type: "string" },
    count: { type: "string", default: "100" },
    out: { type: "string", default: "tokens.json" },
  },
  strict: true,
});

if (!args.userId || !args.token || !args.sessionId) {
  console.error("ERROR: --userId, --token, and --sessionId are required");
  console.error(
    "Usage: npx tsx scripts/generate-load-test-tokens.ts --userId <id> --token <jwt> --sessionId <sessionId> [--count 100] [--out tokens.json]"
  );
  process.exit(1);
}

const count = parseInt(args.count!, 10);
const outFile = args.out!;

const tokens = Array.from({ length: count }, () => ({
  userId: args.userId!,
  token: args.token!,
  sessionId: args.sessionId!,
}));

writeFileSync(outFile, JSON.stringify(tokens, null, 2));
console.log(`✓ Wrote ${count} entries to ${outFile}`);
