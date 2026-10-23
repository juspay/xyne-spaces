import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  autoPostPage,
  buildSamlResponse,
  isGoogleAcs,
  isSignInUrl,
  parseAuthnRequest,
  type SsoConfig,
} from "../src/sso.js";

function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// A throwaway key pair per run: committing one would trip the secret scanner.
function makeKeyPair(): { dir: string; privateKey: string; certificate: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "meet-bot-sso-"));
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1", "-subj", "/CN=meet-bot test",
      "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")],
    { stdio: "ignore" },
  );
  return {
    dir,
    privateKey: readFileSync(path.join(dir, "key.pem"), "utf8"),
    certificate: readFileSync(path.join(dir, "cert.pem"), "utf8"),
  };
}

const ACS = "https://accounts.google.com/samlrp/abc123/acs";

function authnRequestXml(acs = ACS): string {
  return (
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="req-1&lt;x" Version="2.0" ` +
    `IssueInstant="2026-10-21T10:00:00Z" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" ` +
    `AssertionConsumerServiceURL="${acs}">` +
    `<saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">https://accounts.google.com/samlrp/abc123</saml:Issuer>` +
    `<samlp:NameIDPolicy AllowCreate="true" Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified"/>` +
    `</samlp:AuthnRequest>`
  );
}

const redirectEncoded = (xml: string) => deflateRawSync(Buffer.from(xml)).toString("base64");

describe("parseAuthnRequest", () => {
  it("reads Google's redirect-binding request", () => {
    expect(parseAuthnRequest(redirectEncoded(authnRequestXml()), true)).toEqual({
      id: "req-1<x",
      acsUrl: ACS,
      issuer: "https://accounts.google.com/samlrp/abc123",
    });
  });

  it("reads a POST-binding request", () => {
    const encoded = Buffer.from(authnRequestXml()).toString("base64");
    expect(parseAuthnRequest(encoded, false).acsUrl).toBe(ACS);
  });

  it("rejects anything that isn't an AuthnRequest", () => {
    expect(() => parseAuthnRequest("not base64 deflate", true)).toThrow();
    expect(() => parseAuthnRequest(redirectEncoded("<foo/>"), true)).toThrow(/not an AuthnRequest/);
  });
});

describe("URL checks", () => {
  it("only posts to Google", () => {
    expect(isGoogleAcs(ACS)).toBe(true);
    expect(isGoogleAcs("https://www.google.com/a/juspay.in/acs")).toBe(true);
    expect(isGoogleAcs("http://accounts.google.com/samlrp/x/acs")).toBe(false);
    expect(isGoogleAcs("https://accounts.google.com.evil.example/acs")).toBe(false);
    expect(isGoogleAcs("https://evil.example/acs")).toBe(false);
  });

  it("matches the sign-in page whatever the query", () => {
    const signIn = "https://sso.example.internal/saml/sign-in";
    expect(isSignInUrl(`${signIn}?SAMLRequest=x&RelayState=y`, signIn)).toBe(true);
    expect(isSignInUrl(`${signIn}/`, signIn)).toBe(true);
    expect(isSignInUrl("https://sso.example.internal/other", signIn)).toBe(false);
    expect(isSignInUrl("https://evil.example/saml/sign-in", signIn)).toBe(false);
  });
});

describe.skipIf(!hasOpenssl())("buildSamlResponse", () => {
  const keys = makeKeyPair();
  afterAll(() => rmSync(keys.dir, { recursive: true, force: true }));
  const sso: SsoConfig = {
    email: "notetaker@example.com",
    signInUrl: "https://sso.example.internal/saml/sign-in",
    entityId: "https://sso.example.internal/saml/sign-in",
    privateKey: keys.privateKey,
    certificate: keys.certificate,
  };
  const request = { id: "req-1", acsUrl: ACS, issuer: "https://accounts.google.com/samlrp/abc123" };
  const now = Date.parse("2026-10-21T10:00:00Z");
  const xml = Buffer.from(buildSamlResponse(sso, request, now), "base64").toString("utf8");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const one = (name: string) => doc.getElementsByTagNameNS("*", name)[0];

  function verify(signed: string, signatureIndex: number): boolean {
    const verifier = new SignedXml({ publicCert: keys.certificate });
    const parsed = new DOMParser().parseFromString(signed, "text/xml");
    const signature = parsed.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[signatureIndex];
    if (!signature) throw new Error("no signature");
    verifier.loadSignature(signature);
    return verifier.checkSignature(signed);
  }

  it("signs the response and the assertion with the configured key", () => {
    expect(doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")).toHaveLength(2);
    expect(verify(xml, 0)).toBe(true);
    expect(verify(xml, 1)).toBe(true);
  });

  it("puts each signature right after its Issuer, as SAML's schema requires", () => {
    for (const name of ["Response", "Assertion"]) {
      const element = one(name)!;
      const children = Array.from(element.childNodes).filter((n) => n.nodeType === 1) as Element[];
      expect(children.slice(0, 2).map((c) => c.localName)).toEqual(["Issuer", "Signature"]);
    }
  });

  it("signs in the bot account, for Google, in answer to this request", () => {
    expect(one("Response")!.getAttribute("Destination")).toBe(ACS);
    expect(one("Response")!.getAttribute("InResponseTo")).toBe("req-1");
    expect(one("Issuer")!.textContent).toBe(sso.entityId);
    expect(one("StatusCode")!.getAttribute("Value")).toBe("urn:oasis:names:tc:SAML:2.0:status:Success");
    expect(one("NameID")!.textContent).toBe("notetaker@example.com");
    expect(one("NameID")!.getAttribute("Format")).toBe("urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress");
    expect(one("Audience")!.textContent).toBe(request.issuer);
    const confirmation = one("SubjectConfirmationData")!;
    expect(confirmation.getAttribute("Recipient")).toBe(ACS);
    expect(confirmation.getAttribute("InResponseTo")).toBe("req-1");
  });

  it("is only valid for a few minutes around now", () => {
    const conditions = one("Conditions")!;
    expect(conditions.getAttribute("NotBefore")).toBe("2026-10-21T09:59:00Z");
    expect(conditions.getAttribute("NotOnOrAfter")).toBe("2026-10-21T10:05:00Z");
  });

  it("fails verification when tampered with", () => {
    const forged = xml.replace("notetaker@example.com", "someone-else@example.com");
    const valid = (index: number) => {
      try {
        return verify(forged, index);
      } catch {
        return false;
      }
    };
    expect(valid(0)).toBe(false);
    expect(valid(1)).toBe(false);
  });

  it("escapes values from the request", () => {
    const tricky = buildSamlResponse(sso, { ...request, id: 'a"><x y="' }, now);
    const parsed = new DOMParser().parseFromString(Buffer.from(tricky, "base64").toString("utf8"), "text/xml");
    expect(parsed.getElementsByTagNameNS("*", "Response")[0]!.getAttribute("InResponseTo")).toBe('a"><x y="');
  });
});

describe("autoPostPage", () => {
  it("posts the response and relay state to the ACS URL", () => {
    const html = autoPostPage(ACS, "UkVTUE9OU0U=", 'state"&');
    expect(html).toContain(`action="${ACS}"`);
    expect(html).toContain('name="SAMLResponse" value="UkVTUE9OU0U="');
    expect(html).toContain('name="RelayState" value="state&quot;&amp;"');
  });
});
