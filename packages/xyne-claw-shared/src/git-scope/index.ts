/**
 * Git scope: the signed list of repositories ONE sandbox may fetch from or push
 * to through the git-gateway.
 *
 *   signer   builds the list for one SandboxClaim and signs it (private key).
 *   runtime  puts the token on the claim as an annotation. It only carries it.
 *   gateway  finds the caller's claim in its cluster, then
 *              verifyGitScope(token, { keys, expected: { claim, namespace, template } })
 *              parseGitGatewayRequest(method, pathAndQuery)
 *              decideGitRequest(scope, request)
 *            and builds the upstream address from the `host` and `repo` that
 *            were checked, never from the request path it received.
 *
 * TOKEN FORMAT. Test vectors: ./__tests__/git-scope-vectors.json (made by
 * ./__tests__/make-vectors.mjs, which uses node:crypto only and none of this code).
 *
 *   token = B64(header) "." B64(payload) "." B64(signature)     a compact JWS, RFC 7515
 *
 *   B64        base64url (RFC 4648 section 5): A-Z a-z 0-9 - _ only, no "="
 *              padding, no whitespace, unused trailing bits zero.
 *   header     UTF-8 JSON object with exactly these three members, in any order:
 *                { "alg": "ES256", "typ": "xyne-git-scope+jwt", "kid": "<key id>" }
 *   payload    UTF-8 JSON object with exactly these eight members, in any order:
 *                v        1
 *                claim    string   SandboxClaim metadata.name
 *                ns       string   SandboxClaim metadata.namespace
 *                tpl      string   name of the template the claim uses
 *                profile  string   key of the profile the list was built from
 *                iat      integer  unix seconds, when the list was signed
 *                exp      integer  unix seconds, the claim's end time; exp > iat
 *                repos    array, may be empty, of { "repo": string, "access": "rw" | "r" }
 *                         with exactly those two members; no repo twice
 *              claim, ns, tpl, profile: 1 to 253 characters, no control characters.
 *              kid: 1 to 256 characters. iat, exp: 0 to 2^53 - 1.
 *   signature  ECDSA, curve P-256, SHA-256 (ES256, RFC 7518 section 3.4) over
 *              the ASCII bytes of  B64(header) "." B64(payload).  It is the 64
 *              bytes r || s (32 bytes each, big-endian), NOT the ASN.1/DER form
 *              many libraries return by default.
 *   size       the whole token is at most 16384 characters.
 *
 *   access     "rw" = fetch and push, "r" = fetch only.
 *   repo       the repository as "host/segment/segment[/segment...]": what
 *              normalizeRepoUrl (../tools/sandbox/repo-url.ts) returns for the
 *              repository's address. Its steps, in order:
 *                1. trim, lower-case, drop a leading "git+"
 *                2. "user@host:path" becomes "host/path"
 *                3. drop "scheme://", then "userinfo@", then anything from "?" or "#"
 *                4. host = the text before the first "/", without ":port" and
 *                   without one leading "ssh." or "www."
 *                5. path: drop trailing "/", then one trailing ".git";
 *                   "projects/P/repos/R[/...]" becomes "P/R"; drop a leading "scm/";
 *                   "A/B/(tree|blob|src|browse|pull|pulls|-)[/...]" becomes "A/B";
 *                   drop empty segments; fewer than two segments is not a repository
 *              A list entry must also be a value those steps leave unchanged,
 *              with a host of dot-separated labels (a-z 0-9 "-", not at a
 *              label's edge), segments of a-z 0-9 . _ ~ - that are not "." or
 *              "..", and at most 512 characters in all.
 *
 * VERIFICATION returns the payload or exactly one reason:
 *   malformed            not a string, not three parts, a part that is not
 *                        strict B64, a header that is not a JSON object or has a
 *                        member other than alg, typ, kid (or lacks kid)
 *   too-large            longer than 16384 characters
 *   wrong-alg            alg is not exactly "ES256"
 *   wrong-type           typ is not exactly "xyne-git-scope+jwt"
 *   unknown-key          kid is not in the verifier's key set, or the key there
 *                        is not a P-256 public key in a "PUBLIC KEY" PEM
 *   bad-signature        the signature is not 64 bytes or does not verify
 *   unsupported-version  v is not 1
 *   invalid-payload      anything else in the payload that breaks the rules above
 *   not-for-this-claim   claim is not the claim the verifier is asking about
 *   wrong-namespace      ns is not that claim's namespace
 *   wrong-template       tpl is not that claim's template (when the verifier checks it)
 *   expired              now >= exp, or iat is more than 60 seconds in the future
 * When several apply, the first check to fail decides. The checks run in this
 * order: size, three parts, header JSON, alg, typ, header members, strict B64
 * of the other two parts, key, signature, payload JSON, version, the rest of
 * the payload, claim, namespace, template, time.
 *
 * Not rejected: the second valid form of an ECDSA signature (s replaced by
 * n - s). A token is a list, not an identifier; do not key anything on its bytes.
 */
export * from "./repos.js";
export * from "./token.js";
export * from "./request.js";
