# Backward-Compatible Encryption Key Rotation

Ticket: XYNE-61335

## Configuration model

The original environment files remain unchanged:

```text
apps/backend/.env.local
apps/xyne-claw-auth/backend/.env
```

Key-ring support is controlled by separate optional files:

```text
apps/backend/.env.keyring
apps/xyne-claw-auth/backend/.env.keyring
```

The physical presence of `.env.keyring` activates key-ring parsing. Configuration is cached, so processes must be restarted after changing either file.

| File state | Backend behavior |
|---|---|
| Missing | Original legacy reads and writes |
| Invalid or unreadable | Log the reason and use legacy reads and writes |
| Valid without active ID | Read legacy and V2; write legacy |
| Valid with active ID | Read legacy and V2; write V2 |

Claw-auth only reads Spaces ciphertext. Its key-ring file enables V2 reads and does not configure an active writer.

## Important compatibility rule

The original `ENCRYPTION_KEY` remains in the backend `.env.local`.

The original `SPACES_ENCRYPTION_KEY` remains in the Claw-auth `.env`.

Once V2 data exists, do not delete the key-ring files. Removing them prevents V2 ciphertext from being decrypted. To stop V2 writes, retain all keys and remove only `ENCRYPTION_ACTIVE_KEY_ID`.

## Create local K1 files

Generate K1 without displaying it:

```bash
cd /path/to/xyne-spaces
umask 077
K1="$(openssl rand -hex 32)"
```

Create the backend preload file:

```bash
printf \
  "ENCRYPTION_KEYS='[{\"id\":\"k1\",\"key\":\"%s\"}]'\n" \
  "$K1" \
  > apps/backend/.env.keyring

printf \
  "ENCRYPTION_DIAGNOSTIC_LOG_FILE=logs/encryption-diagnostics.jsonl\n" \
  >> apps/backend/.env.keyring

chmod 600 apps/backend/.env.keyring
```

Create the corresponding Claw-auth reader file using the same K1:

```bash
printf \
  "SPACES_ENCRYPTION_KEYS='[{\"id\":\"k1\",\"key\":\"%s\"}]'\n" \
  "$K1" \
  > apps/xyne-claw-auth/backend/.env.keyring

printf \
  "SPACES_ENCRYPTION_DIAGNOSTIC_LOG_FILE=logs/spaces-encryption-diagnostics.jsonl\n" \
  >> apps/xyne-claw-auth/backend/.env.keyring

chmod 600 \
  apps/xyne-claw-auth/backend/.env.keyring

unset K1
```

Never commit either real `.env.keyring` file.

## Legacy-mode verification

Run without either optional file. The original environment files must remain present.

The backend must continue writing:

```text
iv:ciphertext
```

Existing encrypted values and encryption-dependent APIs must continue working.


## Phase 1: Preload K1 readers

Create both `.env.keyring` files, but do not add `ENCRYPTION_ACTIVE_KEY_ID` to the backend file.

Restart:

- Every backend API replica
- Every backend worker
- Claw-auth
- Migration and command-line processes that decrypt data

Expected behavior:

- Existing legacy values decrypt.
- Backend writes remain in the legacy format.
- Backend readers can decrypt future `v2:k1` values.
- Claw-auth can decrypt legacy and `v2:k1` Spaces signing secrets.

## Phase 2: Activate K1 writes

After every reader has been deployed, add this only to the backend file:

```dotenv
ENCRYPTION_ACTIVE_KEY_ID=k1
```

Restart backend APIs and workers.

New ciphertext must use:

```text
v2:k1:iv:ciphertext
```

Existing legacy ciphertext must remain readable.

Claw-auth does not require an active-key setting because it only reads Spaces ciphertext.

## Phase 3: Rotate from K1 to K2

Generate K2 without replacing or regenerating K1:

```bash
umask 077
K2="$(openssl rand -hex 32)"
```

First deploy both readers with K1 and K2 while K1 remains active.

Backend configuration:

```dotenv
ENCRYPTION_KEYS='[
  {"id":"k1","key":"<existing-k1>"},
  {"id":"k2","key":"<new-k2>"}
]'
ENCRYPTION_ACTIVE_KEY_ID=k1
```

Claw-auth configuration:

```dotenv
SPACES_ENCRYPTION_KEYS='[
  {"id":"k1","key":"<existing-k1>"},
  {"id":"k2","key":"<new-k2>"}
]'
```

After every reader is running with both keys, change only the backend active ID:

```dotenv
ENCRYPTION_ACTIVE_KEY_ID=k2
```

Restart backend APIs and workers.

Expected behavior:

- New writes use `v2:k2`.
- Existing `v2:k1` values remain readable.
- Original legacy values remain readable.
- Claw-auth can read legacy, K1, and K2 values.

After storing K2 securely:

```bash
unset K2
```

## Rollback

Before any V2 data exists, removing `.env.keyring` restores the original behavior.

After V2 data exists, do not remove either key-ring file. Removing the ring makes V2 records unavailable.

To stop V2 writes while retaining V2 reads:

1. Keep all existing keys in both key-ring files.
2. Remove only `ENCRYPTION_ACTIVE_KEY_ID` from the backend file.
3. Restart backend APIs and workers.

The backend will return to legacy writes while continuing to read legacy, K1, and K2 data.

If a key-ring file is invalid or unreadable, the service:

1. Logs a sanitized reason.
2. Continues running.
3. Selects the original legacy implementation.
4. Does not use a partially parsed key ring.

## Diagnostic logs

Backend diagnostic events contain:

- Timestamp
- API or background source
- Request ID
- HTTP method
- Express route template
- Encrypt or decrypt operation
- Legacy or V2 format
- Non-secret key ID
- Success or failure
- Safe reason code
- Duration

Diagnostic events never contain:

- Encryption keys
- Plaintext
- Ciphertext
- OAuth tokens
- Signing secrets
- Request bodies
- Raw URLs
- Route parameter values

Display failures:

```bash
jq -c \
  'select(.success == false)' \
  apps/backend/logs/encryption-diagnostics.jsonl
```

Display API encryption activity:

```bash
jq -r \
  'select(.source == "api") |
   [.method, .routeTemplate, .event, .format, .keyId, .success] |
   @tsv' \
  apps/backend/logs/encryption-diagnostics.jsonl
```

List unique API templates that exercised encryption:

```bash
jq -r \
  'select(.source == "api") |
   [.method, .routeTemplate] |
   @tsv' \
  apps/backend/logs/encryption-diagnostics.jsonl |
sort -u
```


## Primary encryption consumers

The backend encryption service is used beneath these API and job families:

- `/api/apps` installations, signing secrets, and webhooks
- Google, Microsoft, Slack, and other OAuth integrations
- `/api/channels` external-source credentials
- `/api/calls` Drive and document credentials
- Automation webhook secrets
- External data-source credentials
- Organization LLM credentials
- AI provisioning jobs
- Migration and background-worker operations

Not every request under these route families performs encryption. The diagnostic log records the exact Express route templates that exercise it during a test.

Claw-auth directly exercises Spaces CBC decryption through:

```text
GET  /admin/diagnose-signing-secret/:slug
POST /admin/backfill-signing-secrets
```

## Backfill dry run

Set the sandbox address and provide credentials without placing the token directly in shell history:

```bash
export CLAW_AUTH_URL="http://localhost:3003"
export ADMIN_USER_ID="<admin-user-id>"

read -r -s ADMIN_TOKEN
```

Validate a bounded batch without updating the database:

```bash
DRY_RUN_RESPONSE="$(
  curl -sS \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "x-user-id: ${ADMIN_USER_ID}" \
    "${CLAW_AUTH_URL}/admin/backfill-signing-secrets?dryRun=true&overwrite=true&limit=25"
)"

printf '%s\n' "$DRY_RUN_RESPONSE" |
jq
```

Successful entries report:

```json
{
  "ok": true,
  "action": "validated"
}
```

Get the next cursor:

```bash
NEXT_AFTER="$(
  printf '%s\n' "$DRY_RUN_RESPONSE" |
  jq -r '.data.nextAfter // empty'
)"
```

If `NEXT_AFTER` is nonempty, run the next page:

```bash
curl -sS \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "x-user-id: ${ADMIN_USER_ID}" \
  "${CLAW_AUTH_URL}/admin/backfill-signing-secrets?dryRun=true&overwrite=true&limit=25&after=${NEXT_AFTER}" |
jq
```

Continue until `nextAfter` is `null`.

## Backfill write

After every dry-run page succeeds, run the first write page:

```bash
WRITE_RESPONSE="$(
  curl -sS \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "x-user-id: ${ADMIN_USER_ID}" \
    "${CLAW_AUTH_URL}/admin/backfill-signing-secrets?overwrite=true&limit=25"
)"

printf '%s\n' "$WRITE_RESPONSE" |
jq
```

Successful entries report:

```json
{
  "ok": true,
  "action": "updated"
}
```

Use `nextAfter` to process subsequent pages. The operation is idempotent: reprocessing an agent replaces its Claw-auth copy with the value decrypted from the authoritative Spaces row.

Clear credentials after testing:

```bash
unset ADMIN_TOKEN
unset ADMIN_USER_ID
unset CLAW_AUTH_URL
```

## Orby sandbox configuration

The existing service environments continue providing:

```dotenv
ENCRYPTION_KEY=<existing-backend-key>
SPACES_ENCRYPTION_KEY=<existing-Spaces-key-in-Claw-auth>
```

Create or mount separate secret files at:

```text
/run/secrets/xyne-spaces/.env.keyring
/run/secrets/xyne-claw-auth/.env.keyring
```

Configure the backend service process with:

```dotenv
ENCRYPTION_KEYRING_ENV_FILE=/run/secrets/xyne-spaces/.env.keyring
```

Configure the Claw-auth service process with:

```dotenv
SPACES_ENCRYPTION_KEYRING_ENV_FILE=/run/secrets/xyne-claw-auth/.env.keyring
```

When file diagnostics are required on the host, use absolute writable log paths inside the key-ring files:

```dotenv
ENCRYPTION_DIAGNOSTIC_LOG_FILE=/var/log/xyne-spaces/encryption-diagnostics.jsonl
SPACES_ENCRYPTION_DIAGNOSTIC_LOG_FILE=/var/log/xyne-claw-auth/spaces-encryption-diagnostics.jsonl
```

Do not use a relative diagnostic path for a file mounted under `/run/secrets`, because the secret directory may not be writable.

The service user must be able to read its key-ring file, but other users should not:

```bash
chmod 600 /run/secrets/xyne-spaces/.env.keyring
chmod 600 /run/secrets/xyne-claw-auth/.env.keyring
```

Use the service account as the file owner when required by the sandbox.

Deploy in this order:

1. Deploy Claw-auth with the K1 reader file.
2. Deploy backend workers with K1 but no active ID.
3. Deploy backend APIs with K1 but no active ID.
4. Verify legacy API operations and diagnostic logs.
5. Add `ENCRYPTION_ACTIVE_KEY_ID=k1`.
6. Restart backend workers and APIs.
7. Verify V2 writes and legacy reads.
8. Run the bounded dry-run backfill.
9. Run the bounded write backfill.
10. Verify all failures are zero or individually explained.

Inspect the installed Orby interface before creating the mounts:

```bash
orby --help
orby secrets --help
orby deploy --help
```

Use the Orby secret-file or volume-mount mechanism available in the sandbox. Do not place real keys in a checked-in deployment manifest.
