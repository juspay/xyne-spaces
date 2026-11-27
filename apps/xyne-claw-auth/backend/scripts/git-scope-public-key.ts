/**
 * Print the public half of claw-auth's git-scope signing key, for the
 * git-gateway's key set ({ "<kid>": "<PUBLIC KEY PEM>" }). Nothing is sent
 * anywhere and the private key is never printed.
 *
 *   CLAW_GIT_SCOPE_PRIVATE_KEY="$(cat key.pem)" CLAW_GIT_SCOPE_KEY_ID=git-scope-1 \
 *     pnpm exec tsx scripts/git-scope-public-key.ts
 *   pnpm exec tsx scripts/git-scope-public-key.ts key.pem git-scope-1
 *
 * Make a new key: openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out key.pem
 */
import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

const [file, kidArg] = process.argv.slice(2);
const pem = (file ? readFileSync(file, "utf8") : (process.env["CLAW_GIT_SCOPE_PRIVATE_KEY"] ?? "")).replace(/\\n/g, "\n").trim();
const kid = (kidArg ?? process.env["CLAW_GIT_SCOPE_KEY_ID"] ?? "").trim();

if (!pem || !kid) {
  console.error("usage: git-scope-public-key.ts [private-key.pem kid]  (or set CLAW_GIT_SCOPE_PRIVATE_KEY and CLAW_GIT_SCOPE_KEY_ID)");
  process.exit(2);
}
const key = createPrivateKey(pem);
if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
  console.error("CLAW_GIT_SCOPE_PRIVATE_KEY must be an EC P-256 private key");
  process.exit(1);
}
const publicPem = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
console.log(`kid: ${kid}`);
console.log(publicPem.trim());
console.log(JSON.stringify({ [kid]: publicPem }));
