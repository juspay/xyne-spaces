# Call Recording Transcription in Xyne Desk (Direct Azure Whisper API)

## Goal

On the telephony call card in `CallThread.tsx` (the `<audio src={telephonyMeta.recordingUrl}>` player), add a "Transcribe" action that produces a transcript — mirroring how voice input works for the composer, but calling **Azure OpenAI Whisper directly from the Node backend** (no Python-agent hop).

## Why direct API (not the Python agent)

The Python agent's `/transcribe-audio` (`transcribe_audio_handler.py`) is a thin wrapper: for the default Azure provider it does one `audio.transcriptions.create(model, file, language)` call. Its extras (hot-words/user-name hints) are **only used on the Google/Deepgram paths**, so going direct to Azure loses nothing. Precedent exists: `apps/xyne-claw-auth/backend/src/lib/azure-tts.ts` calls Azure OpenAI speech endpoints directly with `fetch()`.

## Phase 1 — On-demand transcription (MVP)

### Backend

1. **Config — `apps/backend/src/config/env.ts`**
   - Schema: add `AZURE_OPENAI_STT_ENDPOINT`, `AZURE_OPENAI_STT_API_KEY`, `AZURE_OPENAI_STT_API_VERSION`, `AZURE_OPENAI_STT_MODEL` as `Joi.string().allow('').default('')`.
   - Compose `config.azureStt = { endpoint, apiKey, apiVersion, model }` — a nested object, deliberately *not* following `transcriptionAgentApiKey`'s flat/no-`.allow('')` style (`env.ts:345,984`). Model it on the existing nested pattern instead, e.g. `geniusUpiAnalytics: { apiUrl, apiKey, username }` (`env.ts:~975-982`).

2. **STT service — `services/voiceInputService.ts`** (extend, don't duplicate)
   - Note: this file doesn't talk to Azure today — `transcribeAudio` (`voiceInputService.ts:13-85`) proxies the upload to the **Python agent** (`${pythonAgentUrl}/transcribe-audio`), which is exactly the hop this plan removes. So `transcribeWithAzureStt` is new code, not a refactor; only its logging/error-handling *style* is mirrored from `transcribeAudio`.
   - New method `transcribeWithAzureStt(audio: { buffer, fileName, mimeType }, opts?: { language? })`:
     - POST `{endpoint}/openai/deployments/{model}/audio/transcriptions?api-version={apiVersion}`, multipart (`form-data`, already used — `form.append('audio', ...)` + `form.getHeaders()`), `api-key` header (not `Authorization: Bearer`, per the `azure-tts.ts` precedent), timeout ~300s (recordings, not the 60s used for dictation at `voiceInputService.ts:52`).
     - Fail fast with a clear error if `azureStt` isn't configured.
     - Mirror the existing pre/post-call logging (size in KB, mime, elapsed ms, chars, language — `voiceInputService.ts:39-61`), and adapt the error-normalization branch (`voiceInputService.ts:63-80`) for Azure's own error JSON shape rather than the Python agent's.

3. **Recording lookup — `services/ozonetel/telephonyEmailService.ts`**
   - Public method `getCallRecording(emailId, workspaceId)` → reuse existing private class method `findCallEmailById()` (`telephonyEmailService.ts:413`, already scopes by `workspaceId`) plus the module-scoped helper `parseStoredTelephonyEmailBody()` (`telephonyEmailService.ts:80` — a standalone unexported function in the same file, not a class method). Return `{ recordingUrl, talkTimeSec }` or `null`.
   - Workspace scoping is the security model: recording is resolved from our own stored email row — **never accept a client-supplied URL** (SSRF guard).

4. **Controller — `controllers/voiceInputController.ts`** + **Route — `routes/voiceInput.ts`**
   - `POST /api/voice-input/transcribe-recording` (auth already applied at mount via `authMiddleware.authenticate` on the `/api/voice-input` router, `app.ts:534`; JSON body `{ emailId, language? }`, **no multer needed** — confirm `express.json()` is mounted globally ahead of this router rather than assuming it).
   - Validate user + `emailId`; resolve via `getCallRecording` with `req.user.workspaceId` (confirmed present on `AuthenticatedUser`, `types/express.ts:50`); 404 if no recording.
   - Download server-side: `axios.get(recordingUrl, { responseType: 'arraybuffer', timeout: 120_000 })`, hard cap **25 MB** (Azure Whisper file limit) → 413-style error if exceeded. This is a separate constant from the existing 10 MB `MAX_AUDIO_SIZE_BYTES` client-upload cap in `voiceInputController.ts`/`routes/voiceInput.ts` — don't conflate or reuse that constant. Confirm actual Ozonetel recording format/bitrate before relying on the "~25–30 min of MP3" estimate; a WAV recording would blow past 25 MB much sooner.
   - Call `transcribeWithAzureStt`, respond `{ success, text, language? }` (same shape family as `/transcribe`).

### Frontend (dashboard)

5. **Service — `services/VoiceInput/voiceInputService.ts`**
   - `transcribeRecording(emailId): Promise<{ text, language? }>` — `apiInstance.post('/voice-input/transcribe-recording', ...)` (note: **not** `/voice-input/transcribe/transcribe-recording` — `apiInstance`'s base URL already includes `/api`, and the existing `transcribeAudio` call posts to `/voice-input/transcribe`, confirming the convention is `/voice-input/<route>` with no extra segment), same logging/error-normalization pattern as `transcribeAudio`.

6. **UI — `components/xyne-desk/CallThread/CallThread.tsx`**
   - `CallEntry` gets an optional `emailId` prop. Pass it from `CallThreadItem` (`email.id`) and from `SlackThread.tsx` (has `email.id` at the call site too — button appears in both).
   - Next to the `<audio>`: **"Transcribe"** button with states mirroring voice input UX: `idle → transcribing (spinner + disabled) → done | error(toast)`.
   - On success: transcript in a collapsible block under the player (max-height, scroll) + copy-to-clipboard. In-memory state keyed by component mount (MVP = not persisted).
   - Tracking: follow the existing per-element `data-track-category`/`data-track-name` convention already used one control away (`CallThread.tsx:298-299`, `data-track-category='Support'` + `data-track-name={isCollapsed ? 'ExpandCallEntry' : 'CollapseCallEntry'}`, per `docs/analytics-tooling.md`). Add `data-track-category='Support'` + `data-track-name='TranscribeCallEntry'` on the button, and consider `data-track-metadata` (JSON) to capture success/error state.

### Verification

- `tsc` typecheck + lint on both apps.
- Spike with a real Ozonetel recording: short call and a 15+ min call; confirm 25MB cap behavior and transcription latency of the direct Azure call.
- Verify Ozonetel recording URLs are fetchable server-side (public vs signed/expiring) — affects Phase 2/3 design.
- Edge cases: no recording yet (hide button), double-click debounce, STT not configured (clear toast), inactive Azure deployment name.

## Phase 2 — Persistence (follow-up)

- Add `transcript` to `TelephonyEmailBodyPayload` JSON in the email body; controller writes it back via `emailRepository.update` after success. `CallEntry` already parses that JSON, so transcripts render instantly on load and sync for free. Transcribe button only shows when no transcript stored; add a "Re-transcribe" affordance.

## Phase 3 — Auto-transcribe (optional, later)

- In `telephonyEmailService.applyEvent` (`telephonyEmailService.ts:597-668+`), when a `recording` URL *first* lands, enqueue a background worker job (queue patterns exist, e.g. `warmUserRegistryQueue`, `apps/backend/src/queues/warmUserRegistryQueue.ts`) to transcribe + write back, so the transcript is ready when the ticket opens. Note: `applyEvent` doesn't itself special-case an ENDED status for `recordingUrl` — it just merges whatever the incoming event carries with `previousMeta.recordingUrl`. "First lands on ENDED" is a design assumption about Ozonetel's real-world event sequencing, not something enforced in code today; confirm that assumption (or gate explicitly on `status === 'ENDED'`) before wiring the enqueue.
- Possible extensions: Whisper `prompt` param with the Xyne/Juspay hot-words (`_HOT_WORDS` in the Python agent) for better brand spelling; summary via existing `recordingSummaryTemplates.ts` / `callDocumentService.ts`; diarization if the STT provider supports it.

## Open questions to confirm first

1. Is the Ozonetel `recordingUrl` stable/public long-term, or signed/expiring?
2. Expected max call length? (25 MB ≈ ~25–30 min of MP3.)
3. Should transcripts be searchable / included in the ticket's text? (Drives Phase 2 priority.)
