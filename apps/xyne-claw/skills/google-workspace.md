---
name: google-workspace
description: The asker's connected Google Workspace — Gmail, Calendar, Drive, Docs/Sheets/Slides, Contacts, Tasks — read via the `google` subagent. READ THIS whenever a question touches the asker's email, inbox, sent mail, replies, meetings, schedule, calendar, availability, documents, files, Drive, contacts, or to-dos. Google is a first-class source of truth ALONGSIDE Spaces — do NOT answer mailbox/calendar/Drive questions from Spaces alone.
---

# Google Workspace — the asker's own Gmail, Calendar, Drive, Contacts & Tasks

You have a `google` subagent that reads the **asker's own connected Google account**. It is a **first-class source of truth**, equal to Spaces. A lot of questions that sound like "work" questions actually live in someone's mailbox or calendar, not in the shared workspace. When the answer is about the asker's email, schedule, documents, or to-dos, **Google is the right tool — reach for it as readily as you reach for Spaces.**

> Availability: the `google` subagent only exists when the asker has connected their Google account. If it isn't available or a lookup genuinely returns nothing, say so plainly — never silently fall back to a Spaces guess and present it as the answer.

## What the `google` subagent can do

**Gmail (email)**
- Search the mailbox by keyword, sender, recipient, label, or date window.
- Read full email bodies, whole threads, and attachments.
- Draft replies and new emails (drafts only — *sending* is approval-gated).
- Trash messages (approval-gated).

**Calendar**
- List the asker's calendars and events; see what's on a given day or week.
- Read event details: title, time, location, attendees, organizer, description.
- Check availability ("am I free at 3pm Thursday?").
- Create and delete events (approval-gated).

**Drive (+ Docs / Sheets / Slides)**
- Search Drive for files by name or content.
- Read the full text/content of a document.
- (Edits and uploads are approval-gated.)

**Contacts**
- Search and list the asker's contacts; resolve a name → email address.

**Tasks**
- List task lists and tasks; create / update / complete tasks (writes approval-gated).

## When Google vs when Spaces

Reach for the **`google` subagent** when the answer lives in the asker's personal Google:
- "What did Finance email me about the Q3 budget?" · "Did the vendor ever reply?" · "Find the contract they attached." → **Gmail**
- "What's on my calendar Thursday?" · "When's my next 1:1 with Priya?" · "Am I double-booked tomorrow?" → **Calendar**
- "Find the pricing deck in my Drive." · "What does the onboarding doc say about laptops?" → **Drive**
- "What's Ravi's email address?" → **Contacts**
- "What are my open tasks?" → **Tasks**

Use **Spaces** (spaces tools / the `spaces` subagent) for the *shared* workspace: channel messages, threads, tickets, boards, calls, canvases, knowledge base, activity.

**Many questions span BOTH.** "Catch me up on the Acme deal" can need the Spaces `#acme` channel AND the asker's email thread with Acme. "Did we agree the launch date?" might be half in a thread and half in a calendar invite. When a question could touch either world, **run a Spaces lookup and a Google lookup in parallel and merge** — don't assume the answer is Spaces-only just because Spaces is the default surface.

## How to delegate well
- Hand the `google` subagent a **specific** question with the concrete handle it needs: a sender/keyword for email, a date or window for calendar, a filename or topic for Drive.
- Tell it to **read the full source** (open the email/doc/event), not answer from the search snippet — Gmail/Drive search returns shallow headers.
- Ask it to return **source metadata** so you can attribute: sender + subject + date for email, title + time + organizer for events, file name for docs.

## Attribution — copy Google's `[clf-…#n]` tokens verbatim
Google **search/read results now embed `[clf-…#n]` citation tokens** (Gmail search, Gmail read, Calendar events, Drive search), one per email / event / file. Copy them verbatim next to each fact you draw from them, **exactly like Spaces content** — the chip deep-links to the real Gmail message / Calendar event / Drive file. Never invent or modify a token.

For surfaces that don't carry a token yet (a Drive file or Doc you fully read, Contacts, Tasks), attribute the fact in plain language tied to its real source instead:
- Email → "in Priya's 18 Jun email ('Q3 budget')…"
- Event → "your 'Acme sync' on Thursday, 3–3:30pm…"
- File → "the 'Pricing v4' doc in your Drive…"

## Safety
- **Reads are free; writes need the user.** Sending email, trashing mail, creating/deleting events, and editing Drive are approval-gated — the user gets a confirmation prompt. Default to **drafting**, not sending.
- Never take a destructive action on a vague request — confirm intent first.
