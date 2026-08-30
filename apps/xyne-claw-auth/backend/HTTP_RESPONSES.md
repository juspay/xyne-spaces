# HTTP response envelopes

Standard JSON endpoints in `src/routes` and `src/middleware` use the helpers in
`src/lib/http.ts`.

## Standard success

```json
{ "success": true, "data": {} }
```

Use `sendApiOk(res, data, extra)`. The older `ok()` name remains as a compatibility
alias while routes migrate.

## Standard error

```json
{
  "success": false,
  "error": "Human-readable message",
  "code": "VALIDATION_FAILED"
}
```

Use `sendApiError(res, status, API_ERROR_CODES.<CODE>, message, extra)` for an
immediate response, or throw `HttpError`/one of its status factories from an
`asyncHandler`. `errorMiddleware` converts thrown errors to the same envelope.

The `success` boolean and `error` string are retained for existing clients. The
`code` is the stable field clients should branch on. Unknown exceptions are
logged with internal detail and returned as `INTERNAL_ERROR` with a generic
message.

## Protocol exceptions

These routes intentionally retain their protocol-defined response bodies and are
excluded from the standard-envelope lint rule:

- `src/routes/cli-auth.ts`: OAuth 2.0 device authorization errors such as
  `authorization_pending`, `slow_down`, and `expired_token` are externally
  defined and must remain bare OAuth error payloads.
- `src/routes/flow-action.ts`: Spaces app actions return the typed
  `{ "type": "error", "message": "..." }` action union consumed by the flow
  renderer.

Do not add exceptions for ordinary JSON endpoints. If another external protocol
needs a distinct body, document the owning specification and add a narrow ESLint
exception for only that adapter.

## Migration enforcement

`pnpm lint:http` reports handwritten `{ success: false }`, `{ type: "error" }`,
and bare `{ error }` JSON responses as warnings. The rule is warning-only while
legacy routes are migrated; new and changed standard endpoints should not add
warnings. Promote it to an error after the legacy warnings reach zero.
