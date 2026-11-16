# Automation Webhooks — Usage Guide

> Verified against a running stack on 23 Oct 2026 (live trigger → message in channel, plus the full failure matrix). Every behavioural claim below was confirmed end-to-end, not just inferred from code.

## What it is

`POST /api/automation-webhooks/{seriesId}/{secret}` is the **trigger endpoint of a specific Automation**. You create an automation whose trigger type is `WEBHOOK`; Spaces mints a URL containing a secret; any external system (cron, report generator, CI) POSTs a JSON payload to it. The payload is rendered into the automation's steps — typically a `SEND_MESSAGE` step that posts into a channel.

- **One URL ⇔ one automation.** `{seriesId}` identifies it; `{secret}` is its credential.
- **Intentionally pre-auth** (mounted before session auth, rate-limited by `webhookLimiter` — `apps/backend/src/app.ts:385`). This is what makes it usable from servers and scripts with no user session. Treat the full URL as a credential.
- **It is not the Apps message API.** Posting "as an app" via `postMessage` requires an installed app with `chat:write` + a signed app JWT. For unattended reporter scripts, the webhook is the simpler path.
- **Declared-fields contract.** Extra JSON keys are ignored, but every key declared in the trigger's body schema must be present with the declared type, else `400`.

## Prerequisites (the two things people miss)

### a) The automation must be ACTIVE — approval is what makes it webhook-addressable

New automations are `DRAFT`; drafts never fire. Flow: **DRAFT → Submit for approval → admin approves → ACTIVE**.

⚠ **The subtle part (verified in code and live):** the webhook handler looks the automation up by its *series id* (`automationSeriesId`). A freshly created automation has this column `NULL` — **the approval step stamps it**. Without approval, the webhook URL returns `404 No active webhook automation for this URL` even if the record is somehow ACTIVE. There is no REST endpoint for approving (Zero mutators only, `apps/backend/src/zero/mutators.ts`) — use the UI.

### b) The automation worker must be running (self-hosted only)

A `202` means accepted + enqueued (Bull queue `automations`); a separate worker process executes runs. On Xyne-managed environments it is always running. Self-hosted: start the worker with `ENABLE_AUTOMATION_WORKER=true` (default `false`, `apps/backend/src/config/env.ts:116`; gate in `apps/backend/src/worker.ts`). Otherwise runs stay `PENDING` forever even though the webhook returned 202.

## Step-by-step setup

1. **Create the automation** — UI: *More → Automations → New*; trigger **Webhook** (`WebhookTriggerForm`), declare the **body schema** (and optionally **header schema**). API equivalent: `POST /api/automations` with `{ name, config }` (`automation.routes.ts:74-83`, validated at `:490`). Config shape (`automations/types/automation-config.ts:202`):

   ```json
   {
     "name": "Report → #reports",
     "config": {
       "trigger": {
         "type": "WEBHOOK",
         "config": {
           "bodySchema":   { "report": "string", "reporter": "string" },
           "headerSchema": {}
         }
       },
       "steps": [
         {
           "id": "send_report",
           "type": "SEND_MESSAGE",
           "config": {
             "channelId": "chan_reports_ab12cd34",
             "content": "Report '{{trigger.body.report}}' received from {{trigger.body.reporter}}."
           }
         }
       ]
     }
   }
   ```

   Schema field types: `string | number | boolean | object | array | secret` (`engine/declared-schema.ts`). Fields marked `secret` are redacted from run data.

2. **SEND_MESSAGE step** (`automations/steps/send-message.step.ts`): `channelId` *or* `userIds` required; `content` *or* 1–10 `attachments` (≤ 25 MB total); `senderId` optional (defaults to the Automations bot identity).

3. **Submit for approval → admin approves.** Authors cannot approve their own proposals (`approval.service.ts:140`).

4. **Mint the URL** — automation's webhook panel (`WebhookEndpointPanel`) → create URL. Under the hood: `POST /api/automations/{automationId}/webhook` (`automation.routes.ts:924-925`), returning `{ url, alreadyIssued }`. **The secret is shown once**; minting again reports `alreadyIssued: true` — rotate (re-issue) to get a fresh visible secret (invalidates the old URL).

## Calling the webhook

```bash
curl -X POST \
  'https://spaces.xyne.juspay.net/api/automation-webhooks/<seriesId>/<secret>' \
  -H 'Content-Type: application/json' \
  -d '{"report":"Q3 revenue summary","reporter":"Oindrila"}'
# → 202 {"success":true,"executionId":"<id>"}
```

```python
import requests
r = requests.post(
    "https://spaces.xyne.juspay.net/api/automation-webhooks/<seriesId>/<secret>",
    json={"report": "Q3 revenue summary", "reporter": "Oindrila"},
    timeout=10,
)
r.raise_for_status()
exec_id = r.json()["executionId"]
```

- `Content-Type: application/json`; body must be a JSON object satisfying the declared body schema.
- Declared header fields match case-insensitively; `authorization` and `cookie` are always dropped.

## Response codes (all verified live)

| Situation | Response | Exact body / message (observed) |
|---|---|---|
| Healthy call | `202` | `{"success":true,"executionId":"<id>"}` — accepted & enqueued |
| Declared key missing | `400` | `Payload does not match the declared schema: required key "report" missing` |
| Wrong type for declared key | `400` | `Payload does not match the declared schema: key "report" expected string, got number` |
| Wrong / rotated-out secret | `401` | `Invalid webhook secret` |
| Unknown seriesId, or automation not ACTIVE (incl. series id not stamped) | `404` | `No active webhook automation for this URL` |

Handler: `automations/triggers/webhook-trigger.handler.ts`. A 202 with a forever-PENDING run on self-hosted setups almost always means the worker is not running.

## Templating

| Reference | Resolves to |
|---|---|
| `{{trigger.body.report}}` | a field from the POSTed JSON body (any declared key) |
| `{{trigger.headers.x-report-source}}` | a request header covered by the header schema (auth/cookie dropped) |
| `{{automation.name}}` etc. | metadata of the running automation |
| `{{steps.<stepId>.<output>}}` | an output declared by an earlier step |

- **Embedded refs work:** fields may be pure references or plain text with references inside — `"Report '{{trigger.body.report}}' received."` — both render (`VariableResolver`, `engine/variable-resolver.ts`; anchored regex at `packages/shared/src/automations/variable-ref.ts:20`).
- Unknown paths resolve to empty strings; `__proto__`/`constructor`/`prototype` keys are blocked.

## Verifying a run

```bash
curl -H "Cookie: <session cookie>" \
  https://spaces.xyne.juspay.net/api/automations/runs/<executionId>
# → { status, steps, triggerData: { body, headers, receivedAt }, error }
```

Runs also appear in the automation's history in the dashboard. `secret`-marked fields are redacted in `triggerData`.

## Security & secret handling

- The URL contains the secret in the path — **anyone with the URL can trigger the automation**. Store it like a token.
- Always `https://`; the endpoint is rate-limited server-side (`webhookLimiter`).
- Secret shown **once** at mint; **rotate** from the webhook panel if it leaks (old URL stops working immediately) or revoke it.
- Mark sensitive payload fields `secret` in the schemas so they are redacted from run data and logs.

## Code references

| Behaviour | Where |
|---|---|
| Route mount (pre-auth + rate-limited) | `apps/backend/src/app.ts:385` |
| Create/update payload schemas | `apps/backend/src/routes/automation.routes.ts:74-83`, `:490` |
| Mint / re-issue / revoke URL | `automation.routes.ts:924-925`, `:950`, `:974`, `:990`; UI `WebhookEndpointPanel.tsx`, `automationsApi.ts:464` |
| Config shape (trigger + steps) | `apps/backend/src/automations/types/automation-config.ts:202` |
| SEND_MESSAGE step config | `apps/backend/src/automations/steps/send-message.step.ts` |
| Webhook handler (202/400/401/404, dropped headers) | `apps/backend/src/automations/triggers/webhook-trigger.handler.ts` |
| Schema validation, redaction | `apps/backend/src/automations/engine/declared-schema.ts` |
| Templating | `packages/shared/src/automations/variable-ref.ts:20`; `engine/variable-resolver.ts` |
| Approval stamps series id; no self-approval | `apps/backend/src/services/approval.service.ts:140`; `apps/backend/src/zero/mutators.ts` |
| Worker gate `ENABLE_AUTOMATION_WORKER` | `apps/backend/src/worker.ts`; `config/env.ts:116` |
