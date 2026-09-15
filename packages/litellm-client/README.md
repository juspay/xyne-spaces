# @xyne/litellm-client

Shared Node.js HTTP transport for direct LiteLLM requests from Xyne services.
The package owns timeout handling and optional retries; callers own credentials,
request payloads, response parsing, and service-specific error handling.

```ts
import { fetchLiteLLM } from "@xyne/litellm-client";

const response = await fetchLiteLLM(url, requestInit, {
  timeoutMs: 120_000,
  label: "document-outline",
  maxRetries: 0, // single-shot; omit for the default three retries
});
```

Retryable responses are `429`, `500`, `502`, `503`, and `504`. Network-level
failures are also retried. The helper honors `Retry-After`, then falls back to
approximately 5s, 15s, and 45s backoff.
