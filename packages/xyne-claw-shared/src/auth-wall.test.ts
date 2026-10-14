import { describe, expect, it } from "vitest";
import { isLoginUrl } from "./auth-wall.js";

describe("isLoginUrl", () => {
  it.each([
    "https://accounts.google.com/v3/signin/identifier?continue=x",
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    "https://acme.okta.com/app/xyz",
    "https://acme.auth0.com/u/login",
    "https://github.com/login?return_to=%2Fjuspay%2Fprivate",
    "https://gitlab.com/users/sign_in",
    "https://example.com/oauth/authorize?client_id=1",
    "https://example.com/oauth2/authorize",
    "https://sentry.io/auth/login/",
    "https://app.example.com/sso/start",
  ])("treats %s as a sign-in page", (url) => {
    expect(isLoginUrl(url)).toBe(true);
  });

  it.each([
    "https://github.com/",
    "https://github.com/juspay/xyne-spaces",
    "https://example.com/blog/login-tips",
    "https://example.com/oauth/token",
    "https://docs.example.com/guides/signing-in",
    "not a url",
    "ftp://example.com/login",
  ])("does not treat %s as a sign-in page", (url) => {
    expect(isLoginUrl(url)).toBe(false);
  });
});
