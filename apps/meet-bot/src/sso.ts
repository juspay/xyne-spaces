/**
 * Signs the bot's Google account in with SAML SSO, the way a company's identity
 * provider signs its people in, so nobody ever types a password for it.
 *
 * Google Workspace has an SSO profile assigned to the bot account only. Its sign-in
 * page URL is `sso.signInUrl`. When the bot's browser signs in, Google redirects it
 * there with a SAMLRequest; the bot answers that request in its own browser
 * (Chrome request interception, so the URL never has to exist on the network) with an assertion
 * for `sso.email`, signed with the key whose certificate is uploaded to the profile.
 * The key never leaves the bot and nothing outside the bot's browser can ask for an
 * assertion, which is why there is no HTTP endpoint for this.
 */
import { randomBytes } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import type { BrowserContext, Page } from "playwright";
import { SignedXml } from "xml-crypto";
import { log } from "./log.js";
import { MeetError } from "./meetPage.js";

export interface SsoConfig {
  /** The bot's Google account, e.g. notetaker@juspay.in. */
  email: string;
  /** "Sign-in page URL" of the Google SSO profile. */
  signInUrl: string;
  /** "IDP entity ID" of the Google SSO profile: the Issuer of our assertions. */
  entityId: string;
  /** PEM. */
  privateKey: string;
  /** PEM; the file uploaded to the Google SSO profile as its verification certificate. */
  certificate: string;
}

export interface AuthnRequest {
  id: string;
  /** Where Google wants the response posted (its ACS URL). */
  acsUrl: string;
  /** Google's entity ID, the audience of the assertion. */
  issuer: string;
}

const PROTOCOL_NS = "urn:oasis:names:tc:SAML:2.0:protocol";
const ASSERTION_NS = "urn:oasis:names:tc:SAML:2.0:assertion";
const GOOGLE_ACS_HOSTS = new Set(["accounts.google.com", "www.google.com", "google.com"]);
/** How long an assertion stays usable; Google consumes it within seconds. */
const ASSERTION_TTL_MS = 5 * 60_000;
/** Allowed clock difference between the bot and Google. */
const CLOCK_SKEW_MS = 60_000;

/** True when `url` is a Google ACS URL, the only place the bot posts assertions to. */
export function isGoogleAcs(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && GOOGLE_ACS_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Same page as the configured sign-in URL, whatever the query. */
export function isSignInUrl(url: URL | string, signInUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(signInUrl);
    return a.origin === b.origin && a.pathname.replace(/\/+$/, "") === b.pathname.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

/**
 * Reads Google's AuthnRequest. `deflated` for the HTTP-Redirect binding (query
 * string, what Google uses), plain base64 for HTTP-POST.
 */
export function parseAuthnRequest(samlRequest: string, deflated: boolean): AuthnRequest {
  const raw = Buffer.from(samlRequest, "base64");
  let xml: string;
  try {
    xml = (deflated ? inflateRawSync(raw) : raw).toString("utf8");
  } catch {
    throw new Error("SAMLRequest is not valid deflated base64");
  }
  const doc = new DOMParser({ errorHandler: () => undefined }).parseFromString(xml, "text/xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "AuthnRequest" || root.namespaceURI !== PROTOCOL_NS) {
    throw new Error("SAMLRequest is not an AuthnRequest");
  }
  const id = root.getAttribute("ID") ?? "";
  const acsUrl = root.getAttribute("AssertionConsumerServiceURL") ?? "";
  const issuer = root.getElementsByTagNameNS(ASSERTION_NS, "Issuer")[0]?.textContent?.trim() ?? "";
  if (!id || !acsUrl || !issuer) throw new Error("AuthnRequest is missing its ID, ACS URL or Issuer");
  return { id, acsUrl, issuer };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** SAML instants: UTC, no milliseconds. */
function instant(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function newId(): string {
  return `_${randomBytes(20).toString("hex")}`;
}

function sign(xml: string, element: "Response" | "Assertion", sso: SsoConfig): string {
  const target = element === "Response" ? "/*[local-name(.)='Response']" : "//*[local-name(.)='Assertion']";
  const signer = new SignedXml({
    privateKey: sso.privateKey,
    publicCert: sso.certificate,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  signer.addReference({
    xpath: target,
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
  });
  // SAML's schema puts the signature right after the element's Issuer.
  signer.computeSignature(xml, {
    prefix: "ds",
    location: { reference: `${target}/*[local-name(.)='Issuer']`, action: "after" },
  });
  return signer.getSignedXml();
}

/** A signed SAML Response signing `sso.email` in, base64 for the SAMLResponse form field. */
export function buildSamlResponse(sso: SsoConfig, request: AuthnRequest, now = Date.now()): string {
  const issued = instant(now);
  const notBefore = instant(now - CLOCK_SKEW_MS);
  const notOnOrAfter = instant(now + ASSERTION_TTL_MS);
  const assertionId = newId();
  const issuer = `<saml:Issuer>${escapeXml(sso.entityId)}</saml:Issuer>`;
  const inResponseTo = escapeXml(request.id);
  const acsUrl = escapeXml(request.acsUrl);

  const assertion =
    `<saml:Assertion xmlns:saml="${ASSERTION_NS}" ID="${assertionId}" Version="2.0" IssueInstant="${issued}">` +
    issuer +
    `<saml:Subject>` +
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${escapeXml(sso.email)}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData InResponseTo="${inResponseTo}" NotOnOrAfter="${notOnOrAfter}" Recipient="${acsUrl}"/>` +
    `</saml:SubjectConfirmation>` +
    `</saml:Subject>` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">` +
    `<saml:AudienceRestriction><saml:Audience>${escapeXml(request.issuer)}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${issued}" SessionIndex="${assertionId}">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
    `</saml:AuthnStatement>` +
    `</saml:Assertion>`;

  const response =
    `<samlp:Response xmlns:samlp="${PROTOCOL_NS}" xmlns:saml="${ASSERTION_NS}" ID="${newId()}" Version="2.0" ` +
    `IssueInstant="${issued}" Destination="${acsUrl}" InResponseTo="${inResponseTo}">` +
    issuer +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    assertion +
    `</samlp:Response>`;

  // Both signed, as identity providers usually do: Google accepts either.
  const signed = sign(sign(response, "Assertion", sso), "Response", sso);
  return Buffer.from(signed, "utf8").toString("base64");
}

/** HTML that posts the response to Google, as an identity provider's page would. */
export function autoPostPage(acsUrl: string, samlResponse: string, relayState: string | null): string {
  const relay = relayState ? `<input type="hidden" name="RelayState" value="${escapeXml(relayState)}">` : "";
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>Signing in…</title></head>` +
    `<body onload="document.forms[0].submit()">` +
    `<form method="post" action="${escapeXml(acsUrl)}">` +
    `<input type="hidden" name="SAMLResponse" value="${samlResponse}">${relay}` +
    `<noscript><button type="submit">Continue</button></noscript>` +
    `</form></body></html>`
  );
}

/** What Chrome tells us about a request it paused (CDP Fetch.requestPaused). */
interface PausedRequest {
  requestId: string;
  request: { url: string; method: string; postData?: string };
}

/** Pulls SAMLRequest and RelayState out of a request to the sign-in page. */
function samlParams(request: PausedRequest["request"]): { samlRequest: string | null; relayState: string | null; deflated: boolean } {
  if (request.method === "POST") {
    const form = new URLSearchParams(request.postData ?? "");
    return { samlRequest: form.get("SAMLRequest"), relayState: form.get("RelayState"), deflated: false };
  }
  const url = new URL(request.url);
  return { samlRequest: url.searchParams.get("SAMLRequest"), relayState: url.searchParams.get("RelayState"), deflated: true };
}

/**
 * Answers Google's SSO redirects in this page. Uses Chrome's own request
 * interception (CDP Fetch): Playwright's routes don't see requests a redirect
 * leads to, and Google reaches the sign-in page by redirecting. Returns the last
 * problem answering one, if any, for error messages.
 */
export async function installSsoResponder(page: Page, sso: SsoConfig): Promise<() => string | null> {
  let lastError: string | null = null;
  const cdp = await page.context().newCDPSession(page);
  const respond = (requestId: string, status: number, contentType: string, body: string) =>
    cdp.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: status,
      responseHeaders: [
        { name: "Content-Type", value: contentType },
        { name: "Cache-Control", value: "no-store" },
      ],
      body: Buffer.from(body, "utf8").toString("base64"),
    });

  cdp.on("Fetch.requestPaused", (event: PausedRequest) => {
    void (async () => {
      // Everything on the sign-in host is ours: nothing there may reach the network.
      if (!isSignInUrl(event.request.url, sso.signInUrl)) {
        await respond(event.requestId, 404, "text/plain; charset=utf-8", "Not found");
        return;
      }
      try {
        const { samlRequest, relayState, deflated } = samlParams(event.request);
        if (!samlRequest) throw new Error("Google's redirect has no SAMLRequest");
        const request = parseAuthnRequest(samlRequest, deflated);
        if (!isGoogleAcs(request.acsUrl)) throw new Error(`refusing to sign in to ${request.acsUrl}: not Google`);
        const body = autoPostPage(request.acsUrl, buildSamlResponse(sso, request), relayState);
        log.info("sso_assertion_issued", { email: sso.email, audience: request.issuer });
        await respond(event.requestId, 200, "text/html; charset=utf-8", body);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        log.warn("sso_request_rejected", { error: lastError });
        await respond(event.requestId, 400, "text/plain; charset=utf-8", `SSO failed: ${lastError}`);
      }
    })().catch(() => undefined);
  });
  await cdp.send("Fetch.enable", {
    patterns: [{ urlPattern: `${new URL(sso.signInUrl).origin}/*`, requestStage: "Request" }],
  });
  return () => lastError;
}

// Pages Google can show between the email step and the signed-in redirect.
const NEXT_BUTTON = /^next$/i;
const INTERSTITIAL_BUTTON = /^(i understand|accept|not now)$/i;

async function visible(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().isVisible().catch(() => false);
}

async function clickButton(page: Page, name: RegExp): Promise<boolean> {
  const button = page.getByRole("button", { name }).first();
  if (!(await button.isVisible().catch(() => false))) return false;
  await button.click({ timeout: 5_000 }).catch(() => undefined);
  return true;
}

async function hasGoogleSession(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies("https://accounts.google.com").catch(() => []);
  return cookies.some((cookie) => cookie.name === "SID" || cookie.name === "__Secure-1PSID");
}

/**
 * Signs the bot account in to Google, ending on `continueUrl`. Every step is
 * automatic: Google asks for the email, hands over to the SSO responder, and comes
 * back signed in. Throws MeetError("sso_failed") with what went wrong.
 */
export async function signInWithSso(
  page: Page,
  sso: SsoConfig,
  continueUrl: string,
  lastSsoError: () => string | null,
  timeoutMs = 60_000,
): Promise<void> {
  const fail = (message: string): never => {
    throw new MeetError("sso_failed", message);
  };
  const start = new URL("https://accounts.google.com/ServiceLogin");
  start.searchParams.set("continue", continueUrl);
  start.searchParams.set("Email", sso.email);
  await page.goto(start.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });

  const deadline = Date.now() + timeoutMs;
  let samlrpPolls = 0;
  while (Date.now() < deadline) {
    const url = new URL(page.url());
    if (url.hostname !== "accounts.google.com" && !isSignInUrl(url, sso.signInUrl) && (await hasGoogleSession(page.context()))) {
      log.info("sso_signed_in", { email: sso.email });
      return;
    }
    const ssoError = lastSsoError();
    if (ssoError) fail(`The SSO sign-in page could not answer Google: ${ssoError}`);

    if (url.hostname === "accounts.google.com") {
      if (url.pathname.includes("/challenge/pwd") || (await visible(page, 'input[type="password"]:visible'))) {
        fail(`Google asked for ${sso.email}'s password: the Google SSO profile isn't assigned to that account`);
      }
      if (url.pathname.includes("/signin/rejected")) {
        fail("Google refused to sign in from this browser (it must run headed, not headless)");
      }
      if (url.pathname.includes("/challenge/")) {
        fail(`Google asked ${sso.email} to verify it's them: turn off post-SSO verification for SSO profile users`);
      }
      const text = (await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "")).slice(0, 2_000);
      if (/couldn.t find your google account/i.test(text)) fail(`Google has no account ${sso.email}`);
      if (/type the text you hear or see/i.test(text)) {
        fail("Google showed a CAPTCHA (too many sign-ins from this network); it clears after a while");
      }
      if (/this account (has been|is) disabled|account disabled/i.test(text)) fail(`Google says ${sso.email} is disabled`);
      // Google passes straight through its SAML endpoint; staying there means it is
      // showing an error for our assertion (certificate or entity ID don't match).
      samlrpPolls = url.pathname.includes("/samlrp/") ? samlrpPolls + 1 : 0;
      if (samlrpPolls >= 3) {
        const shown = text.trim().split("\n").filter(Boolean).slice(0, 2).join(" ");
        fail(`Google rejected the SSO sign-in: ${shown || "no message"}. Check the profile's certificate and entity ID`);
      }
      // The email step: a box to fill, or (with the email already in the URL) just "Next".
      const email = page.locator('input[type="email"]:visible').first();
      const emailVisible = await email.isVisible().catch(() => false);
      if (emailVisible && (await email.inputValue().catch(() => "")) !== sso.email) await email.fill(sso.email);
      if (emailVisible || url.pathname.includes("/identifier")) {
        await clickButton(page, NEXT_BUTTON);
      } else {
        await clickButton(page, INTERSTITIAL_BUTTON);
      }
    }
    await page.waitForTimeout(1_000).catch(() => undefined);
  }
  fail(`Google sign-in for ${sso.email} did not finish (stuck on ${new URL(page.url()).origin}${new URL(page.url()).pathname})`);
}
