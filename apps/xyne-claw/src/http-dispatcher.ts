import { Agent, setGlobalDispatcher } from "undici";

const DEFAULT_CONNECTIONS_PER_ORIGIN = 256;

export function installGlobalHttpDispatcher(): number {
  const configured = Number(process.env["XYNE_CLAW_HTTP_CONNECTIONS_PER_ORIGIN"]);
  const connections = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_CONNECTIONS_PER_ORIGIN;
  setGlobalDispatcher(new Agent({ connections }));
  return connections;
}
