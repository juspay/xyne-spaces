import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

// Where a deployment only lets traffic out through an egress proxy (HTTPS_PROXY), send the global fetch through it.
// NODE_USE_ENV_PROXY alone didn't: the provider key check still connected straight to api.anthropic.com, and the mesh
// dropped it. EnvHttpProxyAgent honours NO_PROXY, so in-cluster calls stay direct. Calls that pass their own
// `dispatcher` (safe-fetch, the Claw stream clients) are unaffected.
if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
