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

| App              | Env file     | Base URL variable  | Key               | Model                                      |
| ---------------- | ------------ | ------------------ | ----------------- | ------------------------------------------ |
| `apps/backend`   | `.env.local` | `LITELLM_BASE_URL` | `LITELLM_API_KEY` | `LITELLM_BEST_MODEL`, `LITELLM_FAST_MODEL` |
| `apps/xyne-claw` | `.env`       | `LITELLM_URL`      | `LITELLM_API_KEY` | `LITELLM_MODEL`                            |

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
pnpm run doctor:llm
```

It reads whatever is in the env files and sends one real completion to it, then
says which of the three things is wrong — the URL, the key, or the model name. It
exits non-zero on failure, so CI can run it too. `pnpm run env:setup` runs the same
check automatically on the values you just entered.

Rate limiting counts as a pass: a `429` proves the URL resolved, the key was
accepted, and the model exists.

The equivalent by hand, if you want to see the raw response:

```bash
curl -s "$LITELLM_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $LITELLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}]}' | head -c 400
```

A JSON body containing `choices` means the gateway is good. `401` means the key is
wrong; a connection error means the URL is wrong or the proxy is not running.

One gotcha worth knowing: most OpenAI-compatible gateways expect the base URL to end
in `/v1`. Without it the request 404s, which is easy to misread as a bad key.

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

| Variable                             | App       | Purpose                                        |
| ------------------------------------ | --------- | ---------------------------------------------- |
| `ACTIVITY_CLASSIFICATION_MODEL`      | backend   | Model for classifying activity                 |
| `CALL_LITELLM_MODEL`                 | backend   | Model used for call summarisation              |
| `ENTITY_EXTRACTION_MODEL`            | xyne-claw | Model for the entity-extraction pipeline       |
| `OPENAI_API_BASE` / `OPENAI_API_KEY` | backend   | Alias used by the image-understanding strategy |

## Team Intelligence model and concurrency

Team Intelligence uses the backend LiteLLM connection above, but has separate model,
timeout, and concurrency controls. Configure these in `apps/backend/.env.local` and
restart both the backend and backend worker after changing them. The values shipped in
`apps/backend/.env.example` are safe local starting points:

| Variable                                     | Example     | Purpose                                                                                                                                                    |
| -------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEAM_INTELLIGENCE_LLM_MODEL`                | `open-fast` | Model used for user, team, and organization summaries. It must be available through `LITELLM_BASE_URL`.                                                    |
| `TEAM_INTELLIGENCE_LLM_REQUEST_TIMEOUT_MS`   | `120000`    | Maximum duration of one summary LLM request in milliseconds. Set `0` to disable this timeout.                                                              |
| `TEAM_INTELLIGENCE_LLM_GLOBAL_CONCURRENCY`   | `8`         | Maximum Team Intelligence LLM calls running at once across all summary jobs in this process.                                                               |
| `TEAM_INTELLIGENCE_USER_JOB_CONCURRENCY`     | `1`         | Number of user-ingestion queue jobs processed concurrently by one worker.                                                                                  |
| `TEAM_INTELLIGENCE_TEAM_JOB_CONCURRENCY`     | `1`         | Number of team-summary queue jobs processed concurrently by one worker.                                                                                    |
| `TEAM_INTELLIGENCE_ORG_JOB_CONCURRENCY`      | `1`         | Number of organization-summary queue jobs processed concurrently by one worker.                                                                            |
| `TEAM_INTELLIGENCE_SECTION_CONCURRENCY`      | empty       | Optional global override for the number of summary sections generated in parallel per job. When set, it overrides all three scoped section settings below. |
| `TEAM_INTELLIGENCE_USER_SECTION_CONCURRENCY` | `3`         | User-summary sections generated in parallel when the global section override is empty.                                                                     |
| `TEAM_INTELLIGENCE_TEAM_SECTION_CONCURRENCY` | `3`         | Team-summary sections generated in parallel when the global section override is empty.                                                                     |
| `TEAM_INTELLIGENCE_ORG_SECTION_CONCURRENCY`  | `3`         | Organization-summary sections generated in parallel when the global section override is empty.                                                             |

Section concurrency accepts a positive integer or `all` (`max` and `full` are aliases).
Leaving both the global and scoped value empty uses the built-in value of `3`. Lower
the global LLM and section concurrency values when the LiteLLM gateway returns `429`,
terminates streams, or times out. `TEAM_INTELLIGENCE_SECTION_CONCURRENCY=1` is the
single emergency setting that serializes every user, team, and organization section
wave. The queue concurrency variables accept positive integers only.

The worker itself is controlled separately by the existing
`ENABLE_TEAM_INTELLIGENCE_WORKER` setting. These controls do nothing unless the backend
worker process is running.

## Next

→ [Local Development](local-development.md) · [Troubleshooting](troubleshooting.md)
