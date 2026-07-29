---
name: spaces-citations
description: How to attach inline source citations to claims drawn from Spaces tool results. Load whenever you are about to state a fact from a tool result the user did not see firsthand — search hits, ticket data, meeting insights, message content, canvas excerpts, anything sourced.
---

# Citations — non-negotiable

Tool results from Spaces arrive pre-tagged with inline citation tokens. Your job is to attach the right tokens to the right claims so the user can verify everything you say. A claim without a citation is treated as your opinion; a claim with the wrong citation looks like a lie. Both cost trust.

## Token format

`[clf-<id>#<n>]`

Examples:

- `[clf-ab12#7]`
- `[clf-x9q1#23]`

`<id>` identifies the chunk's parent document; `<n>` identifies the chunk inside it. You don't need to understand the internals — just copy them.

## Rules

1. **Verbatim, always.** Copy the token exactly as it appears in the tool result. Never invent one. Never change the `id`. Never renumber chunks.
2. **One token = one source chunk.** If a sentence draws from three chunks, cite three tokens. Don't merge them into ranges like `[clf-ab12#7-#12]`.
3. **Inline only.** Citations go directly after the sentence or clause they support. No separate "Sources:" section at the end. No footnotes. No "as per [clf-…]" preambles.
4. **Punctuation outside the token.** `…approved in March [clf-ab12#7].` — period after the token, never inside it.
5. **Cite every factual claim.** Names, dates, numbers, decisions, quotes, specifics — anything someone could ask "where did you get that?" about.
6. **Subagent results carry tokens too.** When you delegate to the `spaces` subagent, ask it to return citation tokens and reuse them **exactly** — do not paraphrase, renumber, or fabricate replacements.

## What to cite vs what not to cite

| Cite | Don't cite |
|---|---|
| "The pricing revamp was approved in March." | "Pricing decisions matter." (general statement) |
| "Sarah owns the ingestion rewrite." | "Owners matter on projects." (background principle) |
| "20% rollout for fraud-rule v2 since Monday." | "Gradual rollouts reduce risk." (general reasoning) |
| Quoting what someone said | Summarizing your own opinion |

If you cannot cite a claim, you probably shouldn't be stating it. Search instead — or say "I don't have a source for that."

## Example

> The pricing revamp was approved in the March leadership sync [clf-ab12#7], with rollout targeted for Q3 [clf-ab12#12]. Sarah is driving execution [clf-cd34#3].

Three claims, three tokens, each tied to its own source. That's the bar.
