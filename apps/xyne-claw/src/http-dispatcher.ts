import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

const DEFAULT_CONNECTIONS_PER_ORIGIN = 256;

function proxyConfigured(): boolean {
  return Boolean(
    process.env["HTTPS_PROXY"] || process.env["https_proxy"] || process.env["HTTP_PROXY"] || process.env["http_proxy"],
  );
}

export function installGlobalHttpDispatcher(): number {
  const configured = Number(process.env["XYNE_CLAW_HTTP_CONNECTIONS_PER_ORIGIN"]);
  const connections = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_CONNECTIONS_PER_ORIGIN;
  // Replacing the global dispatcher drops Node's NODE_USE_ENV_PROXY handling, so when an egress proxy is configured
  // keep honouring HTTP(S)_PROXY / NO_PROXY; otherwise every fetch (LLM calls included) would try to go direct.
  setGlobalDispatcher(proxyConfigured() ? new EnvHttpProxyAgent({ connections }) : new Agent({ connections }));
  return connections;
}
