/**
 * Makes the SSO signing key and certificate, once, and prints what to enter in the
 * Google Admin console:
 *
 *   pnpm --filter meet-bot sso:setup
 *
 * The key stays with the bot (sso/idp-key.pem, or SSO_PRIVATE_KEY in production);
 * only the certificate goes to Google. Never overwrites existing keys: replacing them
 * breaks sign-in until the new certificate is uploaded.
 */
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SSO_DIR, DEFAULT_SSO_SIGN_IN_URL } from "./config.js";

const keyFile = path.join(DEFAULT_SSO_DIR, "idp-key.pem");
const certFile = path.join(DEFAULT_SSO_DIR, "idp-cert.pem");

if (existsSync(keyFile) || existsSync(certFile)) {
  console.log(`Keeping the existing SSO key and certificate in ${DEFAULT_SSO_DIR}.`);
} else {
  mkdirSync(DEFAULT_SSO_DIR, { recursive: true });
  try {
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "3650",
        "-subj", "/CN=Xyne Automatic SSO", "-keyout", keyFile, "-out", certFile],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  } catch {
    console.error("Could not run openssl. Install it, or make the key pair elsewhere and set SSO_PRIVATE_KEY / SSO_CERTIFICATE.");
    process.exit(1);
  }
  chmodSync(keyFile, 0o600);
  console.log(`Made a new SSO key and certificate in ${DEFAULT_SSO_DIR}.`);
}

const cert = new X509Certificate(readFileSync(certFile, "utf8"));
const signInUrl = process.env.SSO_SIGN_IN_URL?.trim() || DEFAULT_SSO_SIGN_IN_URL;
const entityId = process.env.SSO_ENTITY_ID?.trim() || signInUrl;
const email = process.env.SSO_EMAIL?.trim() || "<the bot account, e.g. notetaker@your-domain>";

console.log(`
Google Admin console (admin.google.com), as a super admin:

1. Directory > Users: add the bot account ${email}, named "Xyne Automatic".
   Put it in an organizational unit (or group) of its own, e.g. "Meet bots".

2. Security > Authentication > SSO with third-party IdP > Add SAML profile:
     Name                         Xyne Automatic
     IDP entity ID                ${entityId}
     Sign-in page URL             ${signInUrl}
     Verification certificate     upload ${certFile}
   Leave "Use a domain specific issuer" off. Save.

3. Same page > Manage SSO profile assignments: choose ONLY the bot's
   organizational unit or group, and assign it the "Xyne Automatic" profile.
   (Assigning it to everyone would send all of your users to the bot's sign-in.)

4. Security > Authentication > Login challenges > Post-SSO verification, for the
   bot's organizational unit: "Logins using SSO profiles are not subject to
   additional verification checks". Otherwise Google may ask the bot to verify.

Then in apps/meet-bot/.env:  SSO_EMAIL=${email}
and check it:                 pnpm --filter meet-bot sso:check

Certificate: ${cert.subject.replace(/\n/g, ", ")}, valid until ${cert.validTo}
SHA-256 fingerprint: ${cert.fingerprint256}
Keep ${keyFile} secret: whoever has it can sign in as the bot.
`);
