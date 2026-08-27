---
name: Ticket Specs
description: Create, regenerate, update, and review Xyne Spaces ticket Specifications by interviewing for requirement intent before drafting or writing the Specification.
---

# Xyne Spaces Ticket Specification

Use this skill when creating, generating, regenerating, or updating a Xyne Spaces ticket specification.

The purpose of the Specification is to capture the requirement intent so that:

- a developer can understand what is expected,
- a PR reviewer can understand what was requested,
- and the implementation can later be reviewed against that requirement.

The Specification must come from requirement context and user clarification.

Do not generate requirement intent merely by describing the implementation.

---

## Specification sections

Use these headings exactly.

### Required

#### Problem statement

Describe what is wrong, missing, or needed and who or what is affected.

The Problem statement should explain why this work exists.

#### Solutioning

Describe the expected functional behaviour after the change is shipped.

Focus on what must be true functionally, not how the developer should implement it.

#### Test cases

Describe the observable scenarios that confirm the requirement works.

Test cases should make it possible for a developer or reviewer to understand what behaviours need to succeed.

### Optional

#### Implementation details

Technical details, constraints, or implementation context that are useful to the developer or reviewer.

Do not require this section when there is nothing meaningful to record.

#### Out of scope

Anything explicitly excluded from this ticket.

Do not invent non-goals simply to populate this section.

---

# Before the interview

Before creating or regenerating a Specification, first understand the requirement context.

If this is an existing ticket:

1. Fetch the ticket using `spaces-tickets`.
2. Read:
   - ticket title,
   - ticket type, when available,
   - existing description,
   - existing Specification, when present,
   - other relevant requirement context available with the ticket.
3. Use this information to understand what the ticket is about.
4. Use it to formulate better and more relevant clarification questions.
5. Do NOT create or update the Specification yet.

The existing ticket description is context.

It does NOT automatically replace the requirement interview.

Do not silently convert an existing one-line description into a complete Specification.

Do not treat the implementation, PR description, commit messages, or code diff as the source of truth for requirement intent.

---

# Mandatory contextual interview

Before creating or regenerating a Specification, interview the user.

The Specification sections are fixed:

REQUIRED
- Problem statement
- Solutioning
- Test cases

OPTIONAL
- Implementation details
- Out of scope

However, the interview questions are NOT fixed.

The questions MUST be adapted to the context of the specific ticket.

Do not mechanically ask the same questions for every ticket.

---

## Generate questions from the ticket context

Use the ticket title, ticket type, description, current conversation, and other available requirement context to determine what needs clarification.

Generate questions that help you confidently populate the Specification.

Prioritise questions that clarify:

- what was originally requested,
- what problem needs to be solved,
- who or what is affected,
- expected user-visible behaviour,
- important product decisions,
- edge cases,
- failure behaviour,
- success criteria,
- expected test scenarios,
- technical constraints when relevant,
- explicit non-goals or boundaries.

Do NOT simply turn the section headings into generic questions.

Bad:

- What is the problem statement?
- What is the solutioning?
- What are the test cases?
- What are the implementation details?
- What is out of scope?

Instead, understand the requirement first and ask concrete questions about the specific feature, bug, or task.

---

## Example — bug

Ticket:

> Mention picker shows no users in sandbox.

Useful contextual questions might include:

- When the normal user lookup fails or returns no users, what should the picker show instead?
- What should the user see if the fallback also fails?
- Under which environments or conditions is this expected to work?
- Which scenarios should we verify before considering the bug fixed?
- Is anything related to mention behaviour explicitly outside this fix?

These are examples only.

Do not reuse these questions when they are irrelevant to the actual ticket.

---

## Example — feature

Ticket:

> Add people to an existing conversation.

Useful contextual questions might include:

- Who should be allowed to add another person to a conversation?
- What conversation history should a newly added person be able to access?
- How should files and attachments behave for the newly added person?
- What should happen if adding the participant fails?
- What scenarios must work for this feature to be considered complete?
- Is anything explicitly outside the scope of this feature?

These are examples only.

Generate questions appropriate to the actual feature.

---

## Example — technical task

Ticket:

> Move ticket specification merging to the Spaces backend.

Useful contextual questions might include:

- What problem with the current specification update flow are we trying to eliminate?
- What should happen when the ticket already contains a Specification?
- What existing ticket-description content must be preserved?
- What should happen if the Specification is malformed or duplicated?
- What cases should be tested to prove that existing rich-text content is preserved?
- Are any creation or update paths explicitly outside this change?

These are examples only.

---

# Question selection

Ask only questions that materially improve the Specification.

Do not ask the user to repeat information they have already explicitly provided.

For example, if the user has already said:

> Newly added users should see previous messages but should not get access to old attachments.

do not ask:

> Should newly added users see previous messages?

That decision is already established.

Instead, identify what remains unclear.

For example:

- Who is allowed to add people?
- What happens if adding someone fails?
- Does the same behaviour apply to private conversations?
- What scenarios must be verified?

---

## Number of questions

The number of questions should vary based on the complexity and ambiguity of the ticket.

A simple ticket may require only 2–3 clarification questions.

A complex feature may require 6–10 questions.

Do not ask additional questions merely to reach a fixed number.

Ask the minimum useful set of questions needed to establish the required Specification.

---

## Ask questions in one batch

Ask the initial clarification questions together.

Do not unnecessarily ask one question, wait for an answer, then ask the next question.

The user should be able to answer the main interview in one response.

After asking the questions:

STOP.

Wait for the user's response.

Do NOT create or update the Specification in the same turn in which you ask the interview questions.

Do NOT call `spaces-update-ticket` yet.

---

# Requirement source

Problem statement, Solutioning, and Test cases must represent what was requested or explicitly clarified by the user.

Do not construct the requirement by simply summarising:

- the implementation,
- PR diff,
- changed files,
- commit messages,
- PR description,
- or completed code.

Good:

> When the normal user lookup fails, what should the picker show instead?

Bad:

> I see that you implemented a fallback to channel participants. Should the requirement say that?

The implementation may be used as additional context for asking sharper questions.

It must not become the source of truth for requirement intent.

A Specification derived only from the implementation will naturally resemble the implementation and therefore cannot reliably reveal something that was requested but never implemented.

---

# After the user answers

After receiving the user's answers:

1. Map the answers into:
   - Problem statement,
   - Solutioning,
   - Test cases,
   - Implementation details, when applicable,
   - Out of scope, when applicable.

2. Use the user's answers and explicitly provided requirement context as the source of truth.

3. Check whether all required sections can now be populated meaningfully.

Required:
- Problem statement
- Solutioning
- Test cases

4. Do not invent missing information.

5. If required information remains missing or ambiguous, ask only the necessary follow-up questions.

6. Do not repeat the entire interview.

7. Optional sections may be omitted when they are not applicable or the user has provided no meaningful information for them.

---

# Missing information

Never invent a plausible answer.

For required sections:

- If the user's answer is unclear, ask for clarification.
- If an important requirement decision remains unresolved, ask about it.
- Do not consider the Specification complete until the required information is sufficiently clear.

For optional sections:

- Omit the section if there is no meaningful information.
- Do not generate filler merely so every heading appears.

Do not use "Not specified" to bypass missing required information when the user is available to clarify it.

---

# Draft before updating

Once sufficient information has been collected, draft the complete Specification.

Show the draft to the user before modifying the ticket.

Use:

## Specification

### Problem statement
<draft>

### Solutioning
<draft>

### Test cases
<draft>

### Implementation details
<draft, only when applicable>

### Out of scope
<draft, only when applicable>

Then ask the user to confirm or correct the Specification.

Do NOT update the ticket until the user confirms the draft.

---

# Confirmation

The user must have an opportunity to review the generated Specification before it is written to the ticket.

If the user requests changes:

1. Update the draft.
2. Show the changed Specification when necessary.
3. Obtain confirmation.

After the user confirms, create or update the ticket Specification.

---

# Existing Specification edits

A full interview is required when:

- creating the first Specification,
- regenerating the Specification,
- substantially rewriting the Specification,
- or the existing Specification does not contain enough requirement information.

A full interview is NOT required for an explicit targeted edit.

Example:

> Add "notifications are not part of this work" to Out of scope.

In that case:

1. Fetch the existing ticket.
2. Preserve the existing Specification.
3. Apply only the requested change.
4. Show the resulting change/specification to the user when appropriate.
5. Update after confirmation.

Do not ask the user to answer Problem statement, Solutioning, and Test cases again for a simple targeted edit.

If the user says:

- redo the spec,
- regenerate the spec,
- rewrite the spec,
- create a new spec,

run the contextual interview again.

---

# Pasted requirement or external-agent content

If the user pastes:

- a requirement,
- PRD,
- product discussion,
- Slack/thread conversation,
- notes,
- output from another coding agent,
- or other requirement material,

use it as context.

1. Extract information that is explicitly established.
2. Map what is already known to the Specification sections.
3. Identify important ambiguities, missing decisions, edge cases, and missing required information.
4. Generate contextual clarification questions for those gaps.
5. Do not ask the user to repeat information already explicitly provided.
6. Do not silently convert implementation-derived observations into requirement intent.
7. Wait for the user's answers.
8. Map the confirmed information into the Specification.
9. Follow the normal draft → confirmation → update flow.

---

# Writing style

Write Specifications for developers and PR reviewers.

Be concise.

Be concrete.

Prefer observable behaviour.

Avoid vague requirements.

Bad:

> Improve the mention picker.

Good:

> When the primary user lookup returns no users, the mention picker should fall back to eligible channel participants.

Avoid unnecessary implementation prescriptions in Problem statement and Solutioning.

Problem statement should explain the problem.

Solutioning should explain the expected functional outcome.

Implementation details should contain technical implementation constraints when those details actually matter.

---

# Test cases

Test cases should describe meaningful scenarios.

Bad:

> Test the feature.

Better:

> When the primary user lookup returns users, the picker displays those users normally.

> When the primary lookup returns no users, the picker displays eligible channel participants.

> When both the primary lookup and fallback fail, the user sees the specified error state.

Include positive, failure, or edge scenarios when they were established during the interview.

Do not invent test scenarios that were never requested or clarified merely to make the Specification look complete.

---

# Existing tickets

When updating an existing ticket:

- preserve useful existing content,
- preserve Specification sections that are not being changed,
- do not create duplicate Specification blocks,
- do not overwrite unrelated description content.

If asked to create a ticket whose title closely matches an existing ticket, tell the user about the possible duplicate and offer to update the existing ticket instead.

---

# Output structure

The resulting Specification represents:

Specification

Problem statement
<content>

Solutioning
<content>

Test cases
<content>

Implementation details
<content, only when applicable>

Out of scope
<content, only when applicable>

Use these heading names exactly because downstream PR specification review depends on a stable Specification contract.

---

# Writing to Xyne Spaces

When the Xyne Spaces ticket tools support a structured `specification` parameter, pass the Specification sections as structured values.

For example, conceptually:

specification:
- problemStatement
- solutioning
- testCases
- implementationDetails
- outOfScope

Let the Spaces backend render and merge the Specification into the stored rich-text ticket description.

Do not perform a read-modify-write of the complete ticket description merely to add or update the Specification.

Ticket descriptions may contain rich-text HTML.

If the description returned to the agent has been converted to plain text, reading it, appending the Specification, and writing the complete description back can destroy:

- formatting,
- lists,
- links,
- images,
- attachments,
- and other rich-text content.

The Spaces backend should remain responsible for merging structured Specification content into the raw stored ticket description.

---

# Core rules

Always follow these rules:

1. Understand the ticket context before interviewing the user.
2. Questions must vary based on the ticket context.
3. Do not mechanically ask a fixed questionnaire.
4. Ask only questions that materially improve the Specification.
5. Ask the initial questions in one batch.
6. Wait for the user before generating the final Specification.
7. Never invent requirement information.
8. Do not derive requirement intent solely from implementation.
9. Required sections must be meaningfully populated.
10. Optional sections may be omitted.
11. Show the Specification draft before writing it.
12. Obtain user confirmation before updating the ticket.
13. Preserve unrelated existing ticket content.
14. Keep the Specification headings stable for downstream PR review.
