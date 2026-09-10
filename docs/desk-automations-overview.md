# Desk & Automations Overview

This doc is a high-level map of the two products that live at the intersection of support work and workflow automation in `juspay/xyne-spaces`.

- **XyneDesk** — the support / ticketing product.
- **Automations** — the no-code trigger → steps engine.

For the authoritative details, read the source. This file is only an entry point.

---

## XyneDesk

Turns inbound messages from external channels into **tickets** on a **board** and gives agents a mail-client UI to triage, reply, and collaborate.

### Supported desk channels

| Type | Source | Backend path |
|------|--------|--------------|
| `EMAIL` | Gmail / Microsoft 365 / Zoho | `apps/backend/src/adapters/{google,microsoft,zoho}/` |
| `SLACK` | A Slack channel | `apps/backend/src/adapters/slack-desk/` |
| `APP` | Connected Xyne App webhook | `apps/backend/src/integrations/routes/app-desk.ts` |
| `CALL` | Ozonetel telephony | `apps/backend/src/adapters/ozonetel/` |
| `SOCIAL_MEDIA` | Google Play reviews | `apps/backend/src/adapters/social-media/google-play/` |

> The unifying trick: every desk type stores its messages as `Email` rows under a `Conversation`, regardless of the original channel.

### Core data model

```
Channel (desk) ─1:N─▶ Conversation (thread) ─1:1─▶ Ticket (work item)
                            └─1:N─▶ Email (a message, whatever the source)
```

### Key backend layers

| Layer | Path | Responsibility |
|-------|------|----------------|
| Ingestion | `apps/backend/src/integrations/` | Adapters, auth, DL routing, thread matching |
| Domain services | `apps/backend/src/services/` | `emailService`, `ticketService`, assignment, classification |
| Persistence | `apps/backend/src/prisma/schema.prisma` | Postgres/Prisma, Vespa, Redis+Bull, GCS |
| Sync | `apps/backend/src/zero/` | ZQL reads, mutators, side-effect handlers |
| UI | `apps/dashboard/src/routes/SupportScreen/`, `components/xyne-desk/` | Agent support screen |

See [`apps/backend/src/integrations/README.md`](../apps/backend/src/integrations/README.md) for adapter mechanics.

---

## Automations

A no-code engine that listens to events and executes a sequence of steps.

### Spine

```
eventRouter.emit(event, workspaceId)
  → findCandidates(eventType == event && status ACTIVE)
  → WorkflowExecution(PENDING) + WorkflowExecutionState(context)
  → Bull 'automations' queue
  → generic-worker automation worker
  → AutomationExecutor.walkSteps()
  → COMPLETED | FAILED | SKIPPED | CANCELLED | EXTERNAL_WAIT
```

### Processes

| Process | Container | Runs |
|---------|-----------|------|
| API | `xyne-backend` | Registries, `/api/automations` routes, `eventRouter.emit` |
| Worker | `generic-worker` | `automationWorker` + `automationScheduleWorker` — the executor |

### Key directories

| Path | Purpose |
|------|---------|
| `apps/backend/src/automations/triggers/` | Trigger definitions |
| `apps/backend/src/automations/steps/` | Step definitions |
| `apps/backend/src/automations/engine/` | Variable resolver, condition evaluator, executor |
| `apps/backend/src/automations/routes/` | Public & internal API routes |
| `apps/dashboard/src/components/Automation/` | Builder, list, run history UI |

See [`../xyne-automation-e2e-reference.md`](../xyne-automation-e2e-reference.md) for end-to-end trigger/step references.

---

## How Desk and Automations connect

Desk produces events that Automations consumes:

- `EMAIL_RECEIVED`
- `TICKET_CREATED`
- `TICKET_UPDATED`
- `TICKET_COMMENTED`
- `MESSAGE_RECEIVED`
- `CALL_EVENT`
- `TAG_GENERATED`

Automations can act back on Desk through steps such as:

- `ASSIGN_TICKET`, `ASSIGN_TICKET_TO_GROUP`
- `CHANGE_STAGE`, `CLOSE_TICKET`, `UPDATE_TAGS`
- `SEND_EMAIL_REPLY`, `SEND_EMAIL_TO_USER`, `CREATE_EMAIL_DRAFT`
- `APPLY_CONVERSATION_LABEL`, `PROMOTE_MESSAGE_TO_TICKET`

> **Boundary:** `eventRouter.emit` is the dividing line. Upstream (was the ticket/email produced with the right state?) is Desk; downstream (match → enqueue → execute) is Automations.

---

## Notes

- This is a map, not ground truth. Verify claims against current code before relying on them.
- Production is read-only. Do not flush caches, re-run jobs, or mutate live data from these docs.
