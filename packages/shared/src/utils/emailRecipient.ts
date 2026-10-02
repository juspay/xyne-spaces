/**
 * Deliverability check for outbound email recipients (To / Cc / Bcc).
 *
 * Shared by the desk composer (to flag a bad address before Send) and the
 * backend reply/compose endpoints (to reject it with a 400 that names the
 * address, instead of forwarding it to Gmail/Graph and surfacing the
 * provider's opaque `Invalid To header` as a 500).
 *
 * Deliberately stricter than "contains @": Reply All copies addresses from
 * inbound mail verbatim, and other mail systems accept local shorthands such
 * as `support@jiopay` that Gmail/Graph reject — which fails the whole send.
 * Deliberately looser than full RFC 5322: quoted local parts, IP-literal
 * domains and comments are not something a desk agent sends to.
 */

const LOCAL_PART = /^[^\s@<>()[\],;:"\\]+$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const TLD = /^(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;

/**
 * Pull the bare address out of a recipient value. Accepts `user@domain`,
 * `<user@domain>` and `Name <user@domain>`.
 */
export const extractRecipientAddress = (
  raw: string | null | undefined,
): string => {
  const trimmed = (raw ?? "").trim();
  const angled = trimmed.match(/<([^<>]*)>\s*$/);
  return (angled ? angled[1]! : trimmed).trim();
};

/** True when the recipient has a non-empty local part and a fully-qualified domain. */
export const isValidRecipientAddress = (
  raw: string | null | undefined,
): boolean => {
  const address = extractRecipientAddress(raw);
  if (!address || address.length > 254) return false;

  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return false;

  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes(".."))
    return false;

  const labels = domain.split(".");
  if (labels.length < 2) return false; // `support@jiopay` — no TLD
  if (!labels.every((label) => DOMAIN_LABEL.test(label))) return false;
  return TLD.test(labels[labels.length - 1]!);
};

/** Return the recipients that would be rejected by the mail provider, in input order, de-duplicated. */
export const findInvalidRecipients = (
  recipients: ReadonlyArray<string | null | undefined> | null | undefined,
): string[] => {
  const seen = new Set<string>();
  const invalid: string[] = [];
  for (const raw of recipients ?? []) {
    if (isValidRecipientAddress(raw)) continue;
    const value = (raw ?? "").trim();
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    invalid.push(value);
  }
  return invalid;
};
