# AI Providers

Xyne Spaces boots, logs in, and runs without any AI credentials — tickets, chat, calls,
and documents all work. **The AI features do not.** Asking an agent something with no
provider configured fails quietly: the request goes out, nothing comes back, and no
error is shown in the UI.

This page is the missing step between "the stack is running" and "an agent answered me".

## What the apps actually need

Both `apps/backend` and `apps/xyne-claw` talk to an **OpenAI-compatible chat
completions endpoint**. They POST to `<base-url>/chat/completions` with an
`Authorization: Bearer <key>` header — nothing more exotic than that.

That means anything speaking the OpenAI wire format works: a [LiteLLM
proxy](https://docs.litellm.ai/) (what the variable names refer to), OpenAI itself, or
any gateway your organisation already runs.

**The two apps spell the base URL differently.** This trips people up, so set both:

| App | Env file | Base URL variable | Key | Model |
| --- | -------- | ----------------- | --- | ----- |
| `apps/backend` | `.env.local` | `LITELLM_BASE_URL` | `LITELLM_API_KEY` | `LITELLM_BEST_MODEL`, `LITELLM_FAST_MODEL` |
| `apps/xyne-claw` | `.env` | `LITELLM_URL` | `LITELLM_API_KEY` | `LITELLM_MODEL` |

The shipped `.env.example` values are placeholders (`your-litellm-api-key`, and hosts
under `example.com` / `example.net`). They are not reachable — they exist to show the
shape, and leaving them in place is what produces the silent failure above.

## Point at a provider you already have

Fastest path if you have an OpenAI Compatible Provider key or an internal gateway. Using directly:

```bash
# apps/backend/.env.local
LITELLM_BASE_URL=<openai-compatible-provider-endpoint>
LITELLM_API_KEY=<api_key>
LITELLM_BEST_MODEL=<model>
LITELLM_FAST_MODEL=<model>
```

```bash
# apps/xyne-claw/.env
LITELLM_URL=<openai-compatible-provider-endpoint>
LITELLM_API_KEY=<api_key>
LITELLM_MODEL=<model>
```

Any OpenAI-compatible host substitutes directly — replace the URL, key, and model
names with yours.

## Verify before you restart the app

Check the endpoint answers, so you are debugging one thing rather than two:

```bash
curl -s "$LITELLM_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $LITELLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}]}' | head -c 400
```

A JSON body containing `choices` means the gateway is good. `401` means the key is
wrong; a connection error means the URL is wrong or the proxy is not running.

Env files are read at process start, so **restart the apps** after editing:

```bash
pnpm run dev:all
```

## Your first win

1. Open **http://localhost:5173** and sign in with the credentials printed by
   `pnpm run services` (default `admin@xyne.ai` / `xynelocal@123`).
2. Open a space and ask the AI assistant something about the seeded content.
3. A streamed response means the whole chain — dashboard → backend → gateway → model —
   is wired correctly.

If nothing comes back, tail the backend logs (`pnpm --filter xyne-spaces-backend run
dev`) while you send the message. An auth or connection error against the gateway
surfaces there, not in the UI.

## Other model settings

These are optional and fall back to the values above when unset:

| Variable | App | Purpose |
| -------- | --- | ------- |
| `ACTIVITY_CLASSIFICATION_MODEL` | backend | Model for classifying activity |
| `CALL_LITELLM_MODEL` | backend | Model used for call summarisation |
| `ENTITY_EXTRACTION_MODEL` | xyne-claw | Model for the entity-extraction pipeline |
| `OPENAI_API_BASE` / `OPENAI_API_KEY` | backend | Alias used by the image-understanding strategy |

## Next

→ [Local Development](local-development.md) · [Troubleshooting](troubleshooting.md)
