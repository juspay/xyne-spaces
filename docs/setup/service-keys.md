# Service keys

Spaces, claw-auth and the xyne-claw runtime authenticate each other without a shared key.
Each service has its **own** P-256 key pair. It signs a short, single-use assertion per request
(`x-service-assertion`, 60 seconds, bound to the method and path) with its private key, and the
others verify it with its public key. User identity never comes from a header: it comes from a
Spaces delegation or agent token, or from the run's session token that claw-auth issued.

`XYNE_CLAW_S2S_KEY`, `INTERNAL_S2S_KEY` and `CLAW_S2S_USER_PIN` no longer exist. Remove them from
every environment.

## Generate the three key pairs

One pair per service. Run once per environment; never reuse a pair across environments.

```bash
for svc in spaces claw-auth claw-runtime; do
  openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out "${svc}.key"
  openssl ec -in "${svc}.key" -pubout -out "${svc}.pub"
done
```

Env values hold a PEM on one line with `\n` escapes:

```bash
awk '{printf "%s\\n", $0}' spaces.key        # a private key as one line
jq -cn --rawfile k claw-auth.pub '{"claw-1": $k}'   # a public-key map, e.g. CLAW_SERVICE_PUBLIC_KEYS
```

Put each value in its service's secret store, then delete the `*.key` files.

## Which service gets what

| Service | Its own private key | Public keys it holds |
|---|---|---|
| Spaces backend (and worker) | `CLAW_DELEGATION_PRIVATE_KEY` = `spaces.key` (KMS-encrypted in prod), `CLAW_DELEGATION_KEY_ID=spaces-1` | `CLAW_SERVICE_PUBLIC_KEYS` = `{"claw-1": claw-auth.pub}`, `CLAW_RUNTIME_PUBLIC_KEYS` = `{"runtime-1": claw-runtime.pub}` |
| claw-auth | `CLAW_SERVICE_PRIVATE_KEY` = `claw-auth.key`, `CLAW_SERVICE_KEY_ID=claw-1` | `SPACES_DELEGATION_PUBLIC_KEYS` = `{"spaces-1": spaces.pub}`, `CLAW_RUNTIME_PUBLIC_KEYS` = `{"runtime-1": claw-runtime.pub}` |
| xyne-claw runtime | `CLAW_RUNTIME_PRIVATE_KEY` = `claw-runtime.key`, `CLAW_RUNTIME_KEY_ID=runtime-1` | `CLAW_SERVICE_PUBLIC_KEYS` = `{"claw-1": claw-auth.pub}` (and `SPACES_DELEGATION_PUBLIC_KEYS` only if Spaces calls the runtime directly) |

The kid values (`spaces-1`, `claw-1`, `runtime-1`) must match between the private key's
`*_KEY_ID` and the key name in the receivers' public-key maps.

## Rules

- A private key lives only in its own service's secret. Never put two services' private keys in
  one secret, and never give one service another's private key.
- Never put a private key in tool, MCP-server or sandbox environments. The runtime gives tools a
  signing function, not the key.
- Public keys are not secret, but keep them in the same secret store so they rotate together.

## Rotating a key

Public-key maps accept several kids, so a rotation needs no downtime:

1. Generate the new pair with a new kid (e.g. `claw-2`).
2. Add the new public key to every receiver's map next to the old one; deploy the receivers.
3. Switch the sender to the new private key and kid; deploy it.
4. Remove the old public key from the receivers' maps; deploy them; destroy the old private key.
