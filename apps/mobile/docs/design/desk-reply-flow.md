# Xyne Desk reply — Email, App, Slack (mobile)

Port this onto a branch that cannot merge with the branch that already has it. Sending a desk reply is **REST, not a Zero mutator**. If the client inserts a chat message or an `emails` row locally, Slack / the connected app / the mailbox never receive it.

Dashboard reference (same contracts): `apps/dashboard/docs/DESK_COMPOSER_REPLY_FLOW.md`.

---

## 1. Pick the composer from `channel.type`

| `channel.type` | Kind | Thread UI | Reply UI | Send |
| --- | --- | --- | --- | --- |
| `EMAIL` | `mailbox` | Gmail-style stacked emails | Bottom **Reply** bar → full mailbox screen | `POST /email/{conversationId}/reply` |
| `SLACK` | `chat` | Same email thread list (oldest → newest) | Always-visible chat composer | `POST /integrations/slack-desk/{conversationId}/reply` |
| `APP` | `chat` | Same as Slack | Same chat composer | `POST /integrations/app-desk/{conversationId}/reply` |

App and Slack store inbound/outbound as **`emails` rows** on `ticket.conversationId`. There is no separate Slack message table in the desk UI. Agent sends are `email.type === "REPLY"`.

Compose-new-thread (`POST /email/compose`) is **Email desk only**. Slack/App must not show the tickets-list Compose FAB.

```ts
// src/features/xyne-desks/detail/utils/desk-channel-kind.ts
getDeskChannelKind(type)      // 'mailbox' | 'chat' | 'unknown'
getChatDeskIntegration(type)  // 'slack-desk' | 'app-desk' | null
getChatDeskReplyPath(type, conversationId)
  // SLACK → /integrations/slack-desk/{id}/reply
  // APP   → /integrations/app-desk/{id}/reply
  // EMAIL / missing id → null
```

Normalize `channel.type` with `.trim().toUpperCase()`. Do **not** send Slack/App through `/email/.../reply`.

---

## 2. Ticket detail wiring

`TicketDetailScreen` reads the desk channel, then:

```ts
const deskChannelKind = getDeskChannelKind(currentDeskChannelType);
const isMailboxDeskChannel = deskChannelKind === 'mailbox';
const isChatDeskChannel = deskChannelKind === 'chat';
```

Pass into `EmailTab`:

- `showMailboxReplyAction={isMailboxDeskChannel}` — floating Reply bar when `emails.length > 0`
- `onReplyPress` → `router.push('/xyne-desks/[channelId]/[ticketId]/reply')` with `channelId`, `ticketId` (xyneId), `id` (ticket UUID)
- `showChatComposer={isChatDeskChannel}` — in-thread `DeskChatComposer`
- `channelType={currentDeskChannelType}` — needed so send can pick slack vs app
- `isMember` — non-members get `JoinChannelCard` instead of the composer

Reply bar is **not** shown on Slack/App. Chat composer is **not** shown on Email.

---

## 3. Slack / App — in-thread send

### UI

`DeskChatComposer` wraps the existing chat `ConversationInput` (placeholder `Reply to thread...`).

- `conversationId` on the ticket is required. Missing → alert, restore composer text.
- Not a member → join card, do not send.
- After send: clear ticket-detail + tickets list paint caches, toast `Reply sent`.
- App receive-only desks: server still records the row and returns `{ delivered: false }`. Toast `Saved to the ticket, but not sent to the app.` Do not treat that as a hard failure.

### REST

```
POST /integrations/{slack-desk|app-desk}/{conversationId}/reply
{
  "body": "<p>Thanks</p>",          // HTML from the composer
  "attachmentIds": ["att_..."]     // omit when empty
}
```

`apiPost` already authenticates. Paths are relative (client adds `/api`).

Rules:

- `body` is HTML (`buildComposerContentForSend(text, html)`), not Slack mrkdwn. Server converts Slack HTML → mrkdwn.
- Empty body is allowed if `attachmentIds.length > 0`.
- At least one of body or attachments is required.
- Mobile does **not** send `thread_ts`, Slack channel id, or tokens. Server uses `emails[last].externalThreadId` (Slack) or the first email that has one (App).

Slack response: `{ emailId, slackTs }`.  
App response: `{ emailId, threadId, delivered }`.

Do **not** Zero-insert the sent email. Live `emails` query shows the new row.

### Mentions (Slack)

Dashboard mention HTML:

```html
<span data-mention data-mention-type="user" data-user-id="U012ABC" data-username="ada">@ada</span>
```

`data-user-id` is a **Slack** user id. Current mobile composer sends plain HTML (no Slack member picker). Porting can keep plain HTML; adding `GET /integrations/slack-desk/users` is optional follow-up.

---

## 4. Email desk — Reply / Reply all

### UI

1. Ticket Email tab: `MailboxReplyBar` (full-width Reply chip).
2. Route: `app/(protected)/xyne-desks/[channelId]/[ticketId]/reply.tsx`.
3. Screen is the `MailboxReply` compound composer: From, To, Cc, Bcc, Subject, Body, Reply vs Reply all.

Mode state lives on the **screen** (`reply` | `replyAll`), not inside send. Recipients rebuild when mode changes via `recipientPresetKey = \`${latestEmail.id}:${replyMode}\``.

Default mode on this branch is **`reply`** (To = sender / `replyTo`). Reply all is a header control on the composer.

### Recipients (`buildMailboxReplyRecipients`)

Exclude the signed-in mailbox (`fromEmail`) from To/Cc. Dedupe by lowercase email.

| Mode | To | Cc |
| --- | --- | --- |
| `reply` | `replyTo` if set, else `from`. If the sender **is** self, use original `to` instead | empty |
| `replyAll` | `replyTo` or `from`, plus original `to` | original `cc` |

Bcc always starts empty. Subject = `withReplyPrefix(latestEmail.subject ?? ticket.title)` (`Re:` unless already present).

Hydrate body from the user's Zero `emailDrafts` row (`userId === current user`). Pass that row's `id` as `draftId` on send so the server can delete it.

### REST

```
POST /email/{conversationId}/reply
{
  "body": "<p>Thanks.</p><span style=\"font-size:1px;color:transparent;display:inline-block;line-height:0;\">{uuid}</span>",
  "type": "REPLY" | "REPLY_ALL",
  "to": ["customer@example.com"],
  "cc": [],
  "bcc": [],
  "replyToEmailId": "<latest email id>",
  "draftId": "<optional email_drafts id>",
  "subject": "Re: …",
  "attachmentIds": ["att_..."]
}
```

Required: non-empty `to`; `type` is `REPLY` or `REPLY_ALL`; body and/or attachments.

This branch maps UI mode → `type` (`reply` → `REPLY`, `replyAll` → `REPLY_ALL`). Recipients arrays are still the source of truth for who gets the mail. Dashboard historically always posted `REPLY_ALL` and let To/Cc do the work — either is fine if To/Cc are correct.

Client-side body pipeline before POST:

1. `buildComposerContentForSend(text, html)`
2. Strip citation / claw tokens
3. Append signature HTML if present
4. Append a 1px unique token span (Gmail threading)
5. Collect `attachmentIds` from explicit ids **and** `data-att-id` / `/attachments/{id}/download` in HTML

On success: toast `Reply sent` (or server `warning`), paint-cache clear, `router.back()`.

Errors to preserve: `email_reply_disabled`, 401/403/404/422, generic 5xx. See `getMailboxReplySendErrorMessage`.

---

## 5. Email compose (new ticket) — Email desk only

Tickets list FAB when `getDeskChannelKind(channel.type) === 'mailbox'` **and** the user is a member.

Route: `app/(protected)/xyne-desks/[channelId]/compose.tsx`  
`MailboxReply` with `composerMode='compose'`.

```
POST /email/compose
{
  "channelId": "…",
  "subject": "…",
  "body": "<html>…unique token…</html>",
  "to": ["…"],
  "cc": ["…"],
  "bcc": ["…"],
  "attachmentIds": ["att_..."]
}
```

Required: `channelId`, non-empty `to`, non-empty `subject`, body and/or attachments.

Prefill: optional `?to=` query; default Cc from `queries.getEmailChannelPreference({ channelId }).defaultCc` (`parseDefaultCcEmails`).

On success: if `ticketXyneId` is returned, `router.replace` to ticket detail; else `router.back()`.

---

## 6. Attachments

Upload **before** send, then pass ids.

| Context | Upload |
| --- | --- |
| Reply (has conversation) | `POST /email/{conversationId}/upload-attachments` multipart `files` |
| Compose (no conversation) | `POST /email/channels/{channelId}/upload-attachments` |

Response: `{ attachmentIds: string[], failures?: { filename, error }[] }`.

**Gap on this branch:** mailbox `onAttach` is a no-op; chat composer attachments work through `ConversationInput` (uploaded ids go on Slack/App send). When porting, either keep that split or wire mailbox attach to the upload endpoints above.

---

## 7. Drafts (Zero) vs send (REST)

| Desk | Load | Save while typing | After successful send |
| --- | --- | --- | --- |
| Email reply | `detail.emailDrafts` for current user → `initialBodyHtml` | **not implemented** on this branch | pass `draftId`; server deletes |
| Slack / App | chat `ConversationInput` local/Zero **chat** drafts | same as chat composer | none for `email_drafts` |

Dashboard uses `mutators.emailDraft.upsert` / `emailDraft.delete` for **all three** desks (`queries.getDraftForConversation`). Chat-composer drafts (`draft_messages`) are the wrong table for desk tickets.

If the target branch already has `emailDraft` mutators, prefer dashboard parity:

```ts
zero.mutate(mutators.emailDraft.upsert({
  id: existingDraftId ?? uuid(),
  conversationId,
  channelId,              // required
  draftContent: html,
  attachmentIds: ['att_...'],  // optional
  // Email only:
  toRecipients: ['a@x.com'],
  ccRecipients: [],
  bccRecipients: [],
  updatedAt: Date.now(),
}));

zero.mutate(mutators.emailDraft.delete({ conversationId }));
```

Do not upsert an empty body with no attachments (deletes the Draft chip). Opening Reply must not create a phantom draft.

---

## 8. Files to copy (this branch)

Keep paths under `apps/mobile/`.

### Routing / kind

| File | Role |
| --- | --- |
| `src/features/xyne-desks/detail/utils/desk-channel-kind.ts` | EMAIL vs SLACK/APP |
| `src/features/xyne-desks/detail/components/ticket-detail-screen.tsx` | flags + reply navigation |
| `src/features/xyne-desks/detail/components/email-tab/email-tab.tsx` | reply bar vs chat composer |
| `src/features/xyne-desks/detail/components/email-tab/mailbox-reply-bar.tsx` | Email Reply chip |
| `src/features/xyne-desks/tickets/components/tickets-list-screen.tsx` | Compose FAB gated to mailbox |
| `src/features/xyne-desks/tickets/components/tickets-compose-fab.tsx` | FAB |
| `app/(protected)/xyne-desks/[channelId]/[ticketId]/reply.tsx` | Email reply screen |
| `app/(protected)/xyne-desks/[channelId]/compose.tsx` | Email compose screen |

### Slack / App send

| File | Role |
| --- | --- |
| `src/features/xyne-desks/detail/components/desk-chat-composer/desk-chat-composer.tsx` | in-thread composer |
| `src/features/xyne-desks/detail/components/desk-chat-composer/send-chat-desk-reply.ts` | REST + errors |
| `src/features/xyne-desks/detail/components/desk-chat-composer/index.ts` | barrel |

### Email mailbox composer

| File | Role |
| --- | --- |
| `src/features/xyne-desks/detail/components/mailbox-reply/mailbox-reply.tsx` | UI compound |
| `src/features/xyne-desks/detail/components/mailbox-reply/mailbox-reply.send.ts` | REST body + token + errors |
| `src/features/xyne-desks/detail/components/mailbox-reply/mailbox-reply.utils.ts` | recipients, `Re:` prefix |
| `src/features/xyne-desks/detail/components/mailbox-reply/mailbox-reply.suggestions.ts` | To/Cc suggestions |
| `src/features/xyne-desks/detail/components/mailbox-reply/recipient-suggestions-dropdown.tsx` | dropdown |
| `src/features/xyne-desks/detail/components/mailbox-reply/use-desk-contacts.ts` | contact pool |
| `src/features/xyne-desks/detail/components/mailbox-reply/index.ts` | barrel |

Shared helpers already on most branches: `apiPost`, `buildComposerContentForSend`, `ConversationInput`, `ChatComposerDock`, ticket paint caches.

### Tests (copy with the logic)

| File | Covers |
| --- | --- |
| `tests/unit/features/xyne-desks/detail/utils/desk-channel-kind.test.ts` | kind + paths |
| `tests/unit/features/xyne-desks/detail/components/mailbox-reply.utils.test.ts` | reply vs reply-all recipients |
| `tests/unit/features/xyne-desks/detail/components/mailbox-reply.suggestions.test.ts` | suggestion pool |

---

## 9. Do not

- Send Slack/App via `/email/{id}/reply` or Zero `messages.create` / `emails.insert`.
- Show Email Reply bar on Slack/App, or the thread composer on Email.
- Show Compose FAB on Slack/App desks.
- Require mobile to pass Slack `thread_ts` or app webhook URLs.
- Treat App `{ delivered: false }` as a send failure.
- Create a Zero `email_drafts` row just because Reply opened.

---

## 10. Port checklist

- [ ] `getDeskChannelKind` / `getChatDeskReplyPath` + unit tests
- [ ] Ticket Email tab: mailbox bar **or** `DeskChatComposer`, never both
- [ ] Slack/App: `POST /integrations/slack-desk|app-desk/:conversationId/reply` with HTML `body`
- [ ] Allow attachment-only send
- [ ] App receive-only toast when `delivered === false`
- [ ] Email: reply route + `buildMailboxReplyRecipients` + `POST /email/:conversationId/reply`
- [ ] Email: `replyToEmailId` = latest email id; optional `draftId`
- [ ] Unique 1px token on email HTML
- [ ] Compose FAB + `POST /email/compose` on Email desks only
- [ ] After send: paint-cache clear; do not client-insert the email row
- [ ] Non-member: join desk, cannot send

Optional vs this branch (dashboard parity):

- [ ] `emailDraft.upsert` on blur for all three desks; `emailDraft.delete` after send
- [ ] Mailbox attachment upload endpoints
- [ ] Slack `@mention` with Slack user ids
