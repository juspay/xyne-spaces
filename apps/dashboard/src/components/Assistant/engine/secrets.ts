/**
 * Whether the text holds a password, token or key. Such text is never put in a field, sent to
 * Jev or Ask AI, or said back: the user is told to paste it into the page themselves. Pure.
 */

// Tokens by their issuer's prefix (GitHub, GitLab, Slack, OpenAI-style, AWS), and private keys.
const ISSUED =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|glpat-[\w-]{20,}|xox[abprs]-[\w-]{10,}|sk-[\w-]{20,}|AKIA[0-9A-Z]{16})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
// "my password is hunter2", "token: abc123…": a value with a digit or a symbol, so "the token is
// expired" is no secret.
const NAMED =
  /\b(?:password|passcode|passwd|pwd|token|api[ -]?key|secret|private key|access key)\s*(?:is|:|=)\s*(?=[^\s,.;:?]*[\d_@#$%^&*+=/~!-])\S{6,}/i;
// A long run of letters and digits with no spaces, as a token is. Hex alone is a commit hash or
// a UUID, an id people ask about, not a secret.
const OPAQUE = /^(?=[\w+/=-]*\d)(?=[\w+/=-]*[A-Za-z])[\w+/=-]{32,}$/;
const HEX_ID = /^[\da-f-]+$/i;

export const holdsSecret = (text: string): boolean =>
  ISSUED.test(text) ||
  NAMED.test(text) ||
  text.split(/\s+/).some(word => OPAQUE.test(word) && !HEX_ID.test(word));

export const NO_SECRETS =
  'I never take passwords, tokens or keys. Paste it into the page yourself.';
