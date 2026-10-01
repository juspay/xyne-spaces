import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({
  CONFIG: {
    encryptionKey: Buffer.alloc(32),
    oauthStateSigningKey: Buffer.alloc(32),
    legacyOauthStateSigningKey: Buffer.alloc(32),
  },
}));
vi.mock("../db.js", () => ({ prisma: {} }));

const { githubAuthorizeUrl, githubOAuthConfigured } = await import("./github-oauth.js");
const { oauth1Header, xOAuthConfigured } = await import("./twitter-oauth.js");

const ENV = ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET", "X_OAUTH_CONSUMER_KEY", "X_OAUTH_CONSUMER_SECRET"];
afterEach(() => {
  for (const key of ENV) delete process.env[key];
});

describe("GitHub sign-in", () => {
  it("is off until the OAuth app's id and secret are both set", () => {
    expect(githubOAuthConfigured()).toBe(false);
    process.env["GITHUB_OAUTH_CLIENT_ID"] = "id";
    expect(githubOAuthConfigured()).toBe(false);
    process.env["GITHUB_OAUTH_CLIENT_SECRET"] = "secret";
    expect(githubOAuthConfigured()).toBe(true);
  });

  it("sends the user to GitHub with the callback, scopes and a signed state", () => {
    process.env["GITHUB_OAUTH_CLIENT_ID"] = "id";
    process.env["GITHUB_OAUTH_CLIENT_SECRET"] = "secret";
    const url = new URL(githubAuthorizeUrl("user-1", "http://localhost:5173/x"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3003/claw/api/v1/github/callback");
    expect(url.searchParams.get("scope")).toContain("repo");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("refuses when the app isn't set up", () => {
    expect(() => githubAuthorizeUrl("user-1")).toThrow(/not set up/);
  });
});

describe("Sign in with X", () => {
  it("is off until the app's key and secret are both set", () => {
    expect(xOAuthConfigured()).toBe(false);
    process.env["X_OAUTH_CONSUMER_KEY"] = "key";
    process.env["X_OAUTH_CONSUMER_SECRET"] = "secret";
    expect(xOAuthConfigured()).toBe(true);
  });

  it("signs like X's published example", () => {
    // developer.x.com "Creating a signature": the extra parameters stand in for the example's query and body.
    const header = oauth1Header(
      "https://api.twitter.com/1.1/statuses/update.json",
      { key: "xvz1evFS4wEEPTGEFPHBog", secret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw" },
      { include_entities: "true", status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
      { key: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", secret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE" },
      "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      "1318622958",
    );
    const signature = /oauth_signature="([^"]+)"/.exec(header)?.[1];
    expect(decodeURIComponent(signature ?? "")).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  });
});
