# Testing artifact generation with a local transcript

Generate summaries from a **fake transcript in a text file** — no real call, no
Python agent — by hitting the normal endpoints.

Two endpoints:

- **Recordings** → `POST /api/calls/recordings/{callId}/generate-summary`
- **Calls** → `POST /api/calls/{callId}/generate-detailed-summary`

Whenever `src/testTranscripts/transcripts/default.txt` has content, both
endpoints use it as the transcript (it's also written to storage, so it shows in
the UI). Empty or delete the file to fall back to the real GCS transcript.

---

## 1. Setup

1. You already have your call-LLM vars in `apps/backend/.env.local`. Put the
   model name and key you want to run artifacts with there:
   ```
   CALL_LITELLM_API_KEY=<your key>
   CALL_LITELLM_MODEL=<your model>
   ```
2. Restart the backend: `pnpm run dev`.
3. You need an existing `callId` — a **recording** (HEADLESS) for the first
   endpoint, a regular **call** (with a conversation) for the second.
4. These are normal authenticated endpoints, so you need your auth. From the
   browser DevTools → Network → any `/api/calls/...` request, copy either the
   `Authorization: Bearer …` header or the full `Cookie` header.

---

## 2. Add your transcript

Put your transcript in `src/testTranscripts/transcripts/default.txt` (or
`default.md`). **The file content is the transcript, used verbatim.** Write it as
`[MM:SS] Speaker: text` lines — that's the app's format and what makes citations
work:

```
[00:00] Ishaan Rawat: Do we have to revise the commercial for Decathlon ... improve conversion rates.
```

Multi-speaker (for a call) is just more lines:

```
[00:00] Ishaan Rawat: Where are we on the Kotak payment page?
[00:15] Priya Sharma: Design is done; I ship the stripped-down checkout tomorrow.
```

---

## 3. Curls

Replace `<YOUR_JWT>` with your Bearer token and `<CALL_ID>` with your recording /
call id (both from step 1). Everything else is ready to paste.

### Recording summary

```bash
curl --location 'http://localhost:3001/api/calls/recordings/<CALL_ID>/generate-summary' \
--header 'Authorization: Bearer <YOUR_JWT>' \
--header 'Content-Type: application/json' \
--header 'Cookie: u_cohort=4' \
--data '{"summaryTemplateId":"default"}'
```

### Call detailed summary

```bash
curl --location 'http://localhost:3001/api/calls/<CALL_ID>/generate-detailed-summary' \
--header 'Authorization: Bearer <YOUR_JWT>' \
--header 'Content-Type: application/json' \
--header 'Cookie: u_cohort=4' \
--data '{}'
```

- `summaryTemplateId` is a built-in template id (`default` is the built-in).
- Both return JSON when generation completes (they don't stream chunks). Add
  `-w "\n--- %{http_code} in %{time_total}s ---\n"` to any curl to print the
  total generation time.

---

## 4. Postman

- `POST` the URL above, Body → raw → JSON.
- Add the `Authorization` (or `Cookie`) header from your browser.

---

## 5. Notes

- The transcript comes purely from `default.txt` — there's no request flag or
  body field. Change the file, re-hit the endpoint.
- Empty or delete `default.txt` to go back to the real GCS transcript.
- **`team not allowed to access model ...`** — your `CALL_LITELLM_API_KEY` lacks
  that model; provisioning, not this setup. Point `CALL_LITELLM_MODEL` at a model
  your key can access.
