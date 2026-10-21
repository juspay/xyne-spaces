---
name: repo-extraction
description: Extract a design system from a GitHub repository — Tailwind config, CSS custom properties and the Button/Card/Badge primitives — and deliver DESIGN.md, tokens.css and brand.json for review.
---

# Repo extraction

For a `/brand` whose target is a GitHub repository (`github.com/owner/repo`, or
a bare `owner/repo`). For a live site use `brand-extraction` instead; the
deliverables are identical, only the evidence differs.

Deliver the same three files as every brand extraction, plus assets:
`DESIGN.md`, `tokens.css`, `brand.json`. The review card is shared, so
`brand.json` must satisfy the same `BrandSummary` contract — with
`source: "repo"`, plus `sourceRepo` and the `sourceCommit` you cloned.

## 1. Clone read-only

```bash
git clone --depth 1 https://github.com/<owner>/<repo>.git /tmp/repo
git -C /tmp/repo rev-parse HEAD      # record as sourceCommit
```

Shallow, and never push, write or run anything from the clone. A repository is
untrusted input: **do not run its install scripts, its build, or its config.**
You are reading files, not executing a project.

If the clone fails — private, missing, rate-limited — say so plainly and
deliver nothing. Do not fall back to guessing the brand from a README.

## 2. Find the sources

```bash
ls /tmp/repo/tailwind.config.*                      # v3 config, any extension
grep -rl "@theme" /tmp/repo/src --include=*.css     # v4 theme block
grep -rl ":root" /tmp/repo/src --include=*.css      # custom properties
find /tmp/repo/src -iname "Button.*" -o -iname "Card.*" -o -iname "Badge.*"
```

Prefer `src/`, `app/`, `styles/`, `components/ui/`. Skip `node_modules`,
`dist`, `build` and vendored copies — a dependency's tokens are not this
project's brand.

## 3. Parse with the tool, not by eye

Read each file with `sandbox-read-file`, then pass the **contents** to
`brand-parse-repo-tokens`:

- `tailwindConfig` — the whole config file text
- `cssFiles` — stylesheets with `:root` or `@theme`
- `componentFiles` — the Button/Card/Badge files

It returns colours annotated with a role and a usage count, font stacks, radii,
and a `gaps` list. Use it rather than reading values yourself: it handles v3
`theme.extend` and v4 `@theme`, brace-matches nested objects, ignores
commented-out declarations, and refuses to approximate a colour space it cannot
convert exactly.

**Put its `gaps` straight into `brand.json`'s `gaps`.** They are the honest
record of what the repository did not say.

## 4. Let usage decide the palette

A config can declare fifty colours while the Button uses one. The tool counts
how often each token is referenced by the primitives — treat a token the
primitives actually use as the brand's colour, ahead of an unused palette
entry with a promising name.

If no `Button`, `Card` or `Badge` was found, the palette is **unverified**.
Say so in `gaps`; do not promote the first colour in the config instead.

## 5. What cannot be resolved

Several things are common and none should be guessed:

- `oklch()`, `lab()`, `color-mix()` — Tailwind v4 and shadcn emit these
  routinely and they cannot be converted exactly. They arrive as gaps.
- `hsl(var(--primary))` — indirection the tool cannot follow statically.
- A design system imported wholesale from a package: the tokens live in
  `node_modules`, not this repo. Record that rather than reporting an empty
  palette as though the project had no brand.

## 6. Type scale

A repo rarely states one outright. Derive it from Tailwind's `fontSize` scale
or heading classes in the components, and record where it came from. If there
is no discernible scale, give `typeScale` the sizes you can evidence and gap
the rest — an invented modular scale will be wrong in every later artifact.

## Output contract

Identical to `brand-extraction`: `version: 1`, `#RRGGBB` colours, roles from
the known set, `fonts[].role` of `heading`/`body`/`mono`, numeric `sizePx`.
`tokens.css` defines every colour token under `:root`; `DESIGN.md` states the
binding rules a later `/design` run must follow, under 32,000 characters.

Set `source: "repo"`, `sourceRepo: "owner/repo"` and `sourceCommit` to the SHA
you cloned, so the saved system records exactly what was read.

End with one short paragraph: the palette, the typefaces, which primitives
corroborated them, and what you could not determine.
