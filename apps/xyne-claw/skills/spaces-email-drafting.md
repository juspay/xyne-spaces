---
name: spaces-email-drafting
description: Drafting email replies and outbound messages from a Spaces email thread. Load whenever the user asks to draft, write, reply to, or compose an email or message. Covers tone matching, sign-off rules, and what NOT to do.
---

# Drafting emails from a Spaces thread

Email is a separate, high-priority workflow. The goal is a clean, ready-to-send reply — not a search session. Speed and tone match matter more than thoroughness.

## Do not over-search

Do NOT run the general search workflow for an email task. The thread itself is the context; only widen the search if the thread is genuinely insufficient.

When delegating to the `spaces` subagent for an email task, tell it the task type explicitly: *"Need context about &lt;thread / ticket / topic&gt; for email drafting."* That changes how it searches — narrower, faster, focused on the specific thread.

## Steps

1. **Fetch the thread.** Use `spaces-emails`, `spaces-messages`, or `spaces-thread-attachments` to read From/To/Subject/body and history. For ticket-rooted drafts, read the ticket's thread first.
2. **Skip the general search workflow.** Don't crawl the workspace unless the thread is genuinely insufficient.
3. **Match the recipient's tone.** Formal for executives and external customers; casual for teammates. Mirror their language, register, and rhythm.
4. **Address specifics directly.** Reference concrete details — ticket IDs, dates, prior commitments, names. Use real values. No placeholders like `[NAME]`, `[DATE]`, `[COMPANY]`.
5. **Never narrate your process inside the draft.** Don't write "I've looked through our internal channels…" or "After reviewing our knowledge base…". Just write the reply.
6. **Sign-off rules.** Draft on behalf of the authenticated user.
   - Use a neutral closing: `Best regards,` or `Thanks,`.
   - On the next line, the sender's name.
   - Do NOT lift a sign-off name from prior messages, the ticket creator, or any other source.
   - If the sender is a shared mailbox (`support@`, `sales@`), use "Support Team" / "Sales Team" as the sign-off.
7. **Output the body only.** No preamble, no "Here's the draft:", no markdown code fences, no meta-commentary. The first characters of your response are the greeting itself.

## Common mistakes

- Pulling a sign-off name from the previous email's author (that's the recipient, not the sender).
- Adding `[NAME]` / `[DATE]` placeholders — find the real values or drop the line.
- Long preambles ("Below is the draft for your review:") — delete.
- Drafting in formal register when the thread has been casual — match what's there.
- Re-stating the customer's whole problem back to them — they already know it; address it directly.
