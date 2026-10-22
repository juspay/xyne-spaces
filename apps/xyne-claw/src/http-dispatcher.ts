import { Agent, setGlobalDispatcher } from "undici";
import { createScopedGuardLookup } from "./outbound-guard.js";

const DEFAULT_CONNECTIONS_PER_ORIGIN = 256;

export function installGlobalHttpDispatcher(): number {
  const configured = Number(process.env["XYNE_CLAW_HTTP_CONNECTIONS_PER_ORIGIN"]);
  const connections = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_CONNECTIONS_PER_ORIGIN;
  // The connect lookup re-checks every address dialled for hosts that came
  // from a user-supplied provider base URL (see outbound-guard.ts); all other
  // hosts resolve normally.
  setGlobalDispatcher(new Agent({ connections, connect: { lookup: createScopedGuardLookup() } }));
  return connections;
}
