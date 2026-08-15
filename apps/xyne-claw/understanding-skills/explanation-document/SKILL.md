---
name: explanation-document
description: Structure a codebase/schema explanation as a self-contained HTML document a new engineer can read once and act on — sections, per-entity records, relationships, and a lookup table.
---

# Explanation document

The deliverable is ONE self-contained `.html` file written in the sandbox and
sent with `sandbox-deliver-files`. Not chat prose, not a ledger dump.

Lead with the shape, then the parts:

- Header: what this covers, in one sentence, plus the scope you actually
  examined (repo, branch, commit) so a reader knows what it is true of.
- A short "how it fits together" section BEFORE any per-entity detail. A reader
  who stops after it should still understand the system.
- Then one section per group, not one per entity — cluster by role
  (`gateway_*`, `merchant_*`, config vs routing vs audit). Fifty flat sections
  is an inventory, which is what this format exists to avoid.
- Close with a lookup table: every entity, one line each, so the document also
  works as a reference after the first read.

For each entity record what a reader cannot get from its name: who writes it,
who reads it, the key/uniqueness, the scoping column (merchant vs tenant vs
reseller), what breaks if a row is wrong, and one concrete example. A sentence
that only restates the name ("`gateway_card_info` stores gateway card info")
is padding — delete it.

State what you could not determine. An honest gap is information; a confident
guess is a defect a reader inherits.
