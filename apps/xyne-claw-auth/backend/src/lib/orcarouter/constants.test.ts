import { describe, expect, it } from "vitest";

import {
  ORCAROUTER_API_ORIGIN,
  ORCAROUTER_AUTH_ORIGIN,
  ORCAROUTER_INFERENCE_BASE_URL,
  OrcaRouterConfigError,
  assertAllowedOrcaRouterOrigin,
  orcaRouterAuthorizeUrl,
  orcaRouterExchangeUrl,
  orcaRouterModelsUrl,
  resolveApiBase,
  resolveAuthBase,
} from "./constants.js";

describe("defaults", () => {
  it("auth and inference are different origins, and neither is derived from the other", () => {
    expect(resolveAuthBase({})).toBe(ORCAROUTER_AUTH_ORIGIN);
    expect(resolveApiBase({})).toBe(ORCAROUTER_INFERENCE_BASE_URL);
    expect(resolveAuthBase({})).not.toContain(ORCAROUTER_API_ORIGIN);
    expect(resolveApiBase({})).not.toBe(`${ORCAROUTER_AUTH_ORIGIN}/v1`);
  });

  it("auth calls only ever go to the auth origin", () => {
    expect(orcaRouterAuthorizeUrl({})).toBe(`${ORCAROUTER_AUTH_ORIGIN}/auth`);
    expect(orcaRouterExchangeUrl({})).toBe(`${ORCAROUTER_AUTH_ORIGIN}/api/v1/auth/keys`);
    expect(orcaRouterAuthorizeUrl({})).not.toContain(ORCAROUTER_API_ORIGIN);
    expect(orcaRouterExchangeUrl({})).not.toContain(ORCAROUTER_API_ORIGIN);
  });

  it("inference/catalog only ever goes to the api origin", () => {
    expect(orcaRouterModelsUrl({})).toBe(`${ORCAROUTER_API_ORIGIN}/v1/models`);
    expect(orcaRouterModelsUrl({})).not.toContain(ORCAROUTER_AUTH_ORIGIN);
  });

  it("never builds the 404 path", () => {
    const exchange = orcaRouterExchangeUrl({});
    expect(exchange).toContain("/api/v1/auth/keys");
    // Composed from parts so the forbidden path never appears literally here.
    const forbidden = ["/v1", "/auth", "/keys"].join("");
    expect(exchange).not.toBe(`${ORCAROUTER_API_ORIGIN}${forbidden}`);
    expect(exchange).not.toMatch(/^https:\/\/api\./);
  });});

describe("explicit overrides win over the shared fallback, shared over the default", () => {
  it("ORCA_AUTH_BASE_URL overrides only auth", () => {
    const env = { ORCA_AUTH_BASE_URL: "https://auth.internal.example" };
    expect(resolveAuthBase(env)).toBe("https://auth.internal.example");
    expect(resolveApiBase(env)).toBe(ORCAROUTER_INFERENCE_BASE_URL);
    expect(orcaRouterExchangeUrl(env)).toBe("https://auth.internal.example/api/v1/auth/keys");
    expect(orcaRouterModelsUrl(env)).toBe(`${ORCAROUTER_API_ORIGIN}/v1/models`);
  });

  it("ORCA_API_BASE_URL overrides only inference", () => {
    const env = { ORCA_API_BASE_URL: "https://api.internal.example/v1" };
    expect(resolveApiBase(env)).toBe("https://api.internal.example/v1");
    expect(resolveAuthBase(env)).toBe(ORCAROUTER_AUTH_ORIGIN);
    expect(orcaRouterModelsUrl(env)).toBe("https://api.internal.example/v1/models");
    expect(orcaRouterAuthorizeUrl(env)).toBe(`${ORCAROUTER_AUTH_ORIGIN}/auth`);
  });

  it("an explicit override beats the shared fallback for its own side only", () => {
    const env = {
      ORCA_BASE_URL: "https://shared.internal.example",
      ORCA_AUTH_BASE_URL: "https://auth.internal.example",
    };
    expect(resolveAuthBase(env)).toBe("https://auth.internal.example");
    // The api side still takes the shared fallback, not the auth override.
    expect(resolveApiBase(env)).toBe("https://shared.internal.example/v1");
  });

  it("the shared fallback feeds BOTH sides for a one-origin self-hosted deployment", () => {
    const env = { ORCA_BASE_URL: "https://orca.selfhosted.example" };
    expect(resolveAuthBase(env)).toBe("https://orca.selfhosted.example");
    expect(resolveApiBase(env)).toBe("https://orca.selfhosted.example/v1");
    expect(orcaRouterExchangeUrl(env)).toBe("https://orca.selfhosted.example/api/v1/auth/keys");
    expect(orcaRouterModelsUrl(env)).toBe("https://orca.selfhosted.example/v1/models");
  });

  it("a bare api override gets /v1; an override with a path is used verbatim", () => {
    expect(resolveApiBase({ ORCA_API_BASE_URL: "https://api.internal.example" })).toBe(
      "https://api.internal.example/v1",
    );
    expect(resolveApiBase({ ORCA_API_BASE_URL: "https://api.internal.example/proxy" })).toBe(
      "https://api.internal.example/proxy",
    );
  });

  it("strips trailing slashes so path joining stays trivial", () => {
    expect(resolveAuthBase({ ORCA_AUTH_BASE_URL: "https://auth.internal.example///" })).toBe(
      "https://auth.internal.example",
    );
  });

  it("ignores an empty override rather than treating it as configured", () => {
    expect(resolveAuthBase({ ORCA_AUTH_BASE_URL: "   " })).toBe(ORCAROUTER_AUTH_ORIGIN);
    expect(resolveApiBase({ ORCA_API_BASE_URL: "" })).toBe(ORCAROUTER_INFERENCE_BASE_URL);
  });
});

describe("origin guard — https only, loopback may use http", () => {
  it("accepts https remote origins", () => {
    expect(assertAllowedOrcaRouterOrigin("https://www.orcarouter.ai", "authBase")).toBe(
      "https://www.orcarouter.ai",
    );
  });

  it("rejects http for a remote host", () => {
    expect(() => assertAllowedOrcaRouterOrigin("http://www.orcarouter.ai", "authBase")).toThrow(
      OrcaRouterConfigError,
    );
    expect(() => assertAllowedOrcaRouterOrigin("http://orca.internal.example", "apiBase")).toThrow(/https/);
  });

  it("allows http for localhost / 127.0.0.1 / [::1]", () => {
    expect(assertAllowedOrcaRouterOrigin("http://localhost:8787", "authBase")).toBe("http://localhost:8787");
    expect(assertAllowedOrcaRouterOrigin("http://127.0.0.1:8787", "authBase")).toBe("http://127.0.0.1:8787");
    expect(assertAllowedOrcaRouterOrigin("http://127.0.0.1", "authBase")).toBe("http://127.0.0.1");
    expect(assertAllowedOrcaRouterOrigin("http://[::1]:8787", "authBase")).toBe("http://[::1]:8787");
  });

  it("rejects a non-http(s) scheme, a relative URL and embedded credentials", () => {
    expect(() => assertAllowedOrcaRouterOrigin("ftp://orca.example", "authBase")).toThrow(OrcaRouterConfigError);
    expect(() => assertAllowedOrcaRouterOrigin("/auth", "authBase")).toThrow(OrcaRouterConfigError);
    expect(() => assertAllowedOrcaRouterOrigin("https://user:pass@orca.example", "authBase")).toThrow(
      /credentials/,
    );
    expect(() => assertAllowedOrcaRouterOrigin("", "authBase")).toThrow(OrcaRouterConfigError);
  });

  it("the resolver enforces the guard on env overrides too", () => {
    expect(() => resolveAuthBase({ ORCA_AUTH_BASE_URL: "http://orca.example" })).toThrow(/https/);
    expect(() => resolveApiBase({ ORCA_API_BASE_URL: "http://orca.example" })).toThrow(/https/);
    expect(() => resolveApiBase({ ORCA_BASE_URL: "http://orca.example" })).toThrow(/https/);
    expect(resolveAuthBase({ ORCA_BASE_URL: "http://localhost:9000" })).toBe("http://localhost:9000");
  });
});
