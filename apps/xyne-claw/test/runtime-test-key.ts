import { generateKeyPairSync } from "node:crypto";

/** A throwaway P-256 key so the runtime can sign its calls in tests (read lazily per call). */
export function useRuntimeTestKey(): void {
  if (process.env["CLAW_RUNTIME_PRIVATE_KEY"]) return;
  process.env["CLAW_RUNTIME_PRIVATE_KEY"] = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
}
