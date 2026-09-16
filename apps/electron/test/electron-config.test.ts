/**
 * Open-source readiness regression tests for the Electron shell.
 *
 * The Electron app previously hardcoded the internal deployment suffix
 * (`xyne.juspay.net`) in three security gates (preload isTrustedOrigin,
 * request-interceptor isFirstPartyUrl, handlers cookie-sync) and the CSP,
 * and its prod/sandbox configs carried internal URLs with no env override.
 * These tests pin the scrubbed contract:
 *
 *   1. first-party host derivation is a pure function of the configured
 *      URLs (with an explicit XYNE_FIRST_PARTY_HOST_SUFFIX override for
 *      internal deployments);
 *   2. every deployment URL in the app config is env-overridable
 *      (extending the existing RELEASE_CONFIG_URL / UI_ZIP_URL precedent);
 *   3. the default (unconfigured) config carries no internal hostnames.
 *
 * Located in test/ (outside tsconfig `include: ["src"]`) because vitest is
 * not an app dependency; run with the workspace vitest, e.g.
 *   cd apps/electron && ../xyne-claw-auth/backend/node_modules/.bin/vitest run test/electron-config.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const CONFIG_ENV_KEYS = [
  "BACKEND_URL",
  "MTLS_BACKEND_URL",
  "MTLS_FRONTEND_URL",
  "UNPROTECTED_URL",
  "FRONTEND_URL",
  "CLAW_AUTH_URL",
  "RELEASE_CONFIG_URL",
  "UI_ZIP_URL",
] as const;

describe("firstPartyHosts (pure derivation)", () => {
  it("derives the common host suffix shared by the configured first-party URLs", async () => {
    const mod = await import("../src/app/firstPartyHosts");
    const suffix = mod.firstPartyHostSuffix(
      [
        "https://app.spaces.example.com",
        "https://auth.spaces.example.com",
        "https://spaces.example.com",
      ],
      undefined,
    );
    expect(suffix).toBe("spaces.example.com");
    expect(mod.isFirstPartyHostname("app.spaces.example.com", suffix)).toBe(
      true,
    );
    expect(mod.isFirstPartyHostname("auth.spaces.example.com", suffix)).toBe(
      true,
    );
    expect(mod.isFirstPartyHostname("spaces.example.com", suffix)).toBe(true);
    // Sibling subdomains under the same suffix are first-party.
    expect(
      mod.isFirstPartyHostname("anything.spaces.example.com", suffix),
    ).toBe(true);
    // Look-alike hosts must NOT match.
    expect(mod.isFirstPartyHostname("evil.example.com", suffix)).toBe(false);
    expect(mod.isFirstPartyHostname("notspaces.example.com", suffix)).toBe(
      false,
    );
    expect(
      mod.isFirstPartyHostname("spaces.example.com.attacker.net", suffix),
    ).toBe(false);
  });

  it("prefers the explicit XYNE_FIRST_PARTY_HOST_SUFFIX override (internal deployments)", async () => {
    const mod = await import("../src/app/firstPartyHosts");
    expect(
      mod.firstPartyHostSuffix(
        ["https://app.spaces.example.com"],
        "internal.example.net",
      ),
    ).toBe("internal.example.net");
  });

  it("collapses localhost dev URLs to a localhost suffix", async () => {
    const mod = await import("../src/app/firstPartyHosts");
    expect(
      mod.firstPartyHostSuffix(
        [
          "http://localhost:3001",
          "http://localhost:5173",
          "http://localhost:3003",
        ],
        undefined,
      ),
    ).toBe("localhost");
  });

  it("fails closed on unusable input", async () => {
    const mod = await import("../src/app/firstPartyHosts");
    expect(mod.firstPartyHostSuffix([], undefined)).toBeNull();
    expect(mod.firstPartyHostSuffix(["not a url"], undefined)).toBeNull();
    expect(mod.isFirstPartyHostname("app.spaces.example.com", null)).toBe(
      false,
    );
    expect(mod.isFirstPartyHostname("", "spaces.example.com")).toBe(false);
  });
});

describe("app config (env overrides + neutral defaults)", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of CONFIG_ENV_KEYS) delete process.env[key];
    delete process.env["XYNE_FIRST_PARTY_HOST_SUFFIX"];
  });

  it("every deployment URL is overridable via env", async () => {
    process.env["BACKEND_URL"] = "https://backend.internal.example.net";
    process.env["MTLS_BACKEND_URL"] =
      "https://mtls-backend.internal.example.net";
    process.env["MTLS_FRONTEND_URL"] =
      "https://mtls-frontend.internal.example.net";
    process.env["UNPROTECTED_URL"] = "https://unprotected.internal.example.net";
    process.env["FRONTEND_URL"] = "https://frontend.internal.example.net";
    process.env["CLAW_AUTH_URL"] = "https://claw.internal.example.net";
    const { config } = await import("../src/app/config");
    expect(config.BACKEND_URL).toBe("https://backend.internal.example.net");
    expect(config.MTLS_BACKEND_URL).toBe(
      "https://mtls-backend.internal.example.net",
    );
    expect(config.MTLS_FRONTEND_URL).toBe(
      "https://mtls-frontend.internal.example.net",
    );
    expect(config.UNPROTECTED_URL).toBe(
      "https://unprotected.internal.example.net",
    );
    expect(config.FRONTEND_URL).toBe("https://frontend.internal.example.net");
    expect(config.CLAW_AUTH_URL).toBe("https://claw.internal.example.net");
  });

  it("default prod config carries no internal hostnames", async () => {
    const { config } = await import("../src/app/config");
    const joined = [
      config.BACKEND_URL,
      config.MTLS_BACKEND_URL,
      config.MTLS_FRONTEND_URL,
      config.UNPROTECTED_URL,
      config.FRONTEND_URL,
      config.CLAW_AUTH_URL,
      config.RELEASE_CONFIG_URL,
      config.UI_ZIP_URL,
    ].join(" ");
    expect(joined).not.toMatch(/juspay|rbihub|svc\.k8s/i);
    // And the derived first-party suffix contains no internal hostname.
    const hosts = await import("../src/app/firstPartyHosts");
    const suffix = hosts.firstPartyHostSuffix(
      [
        config.BACKEND_URL,
        config.FRONTEND_URL,
        config.CLAW_AUTH_URL,
        config.UNPROTECTED_URL,
        config.MTLS_BACKEND_URL,
        config.MTLS_FRONTEND_URL,
      ],
      process.env["XYNE_FIRST_PARTY_HOST_SUFFIX"],
    );
    expect(suffix).not.toMatch(/juspay|rbihub/i);
  });
});
