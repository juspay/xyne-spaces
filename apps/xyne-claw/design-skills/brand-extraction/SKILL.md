---
name: brand-extraction
description: Extract a design system from a live website or a screenshot — colours, typography, scale, radii, spacing, shadows, logo — and deliver DESIGN.md, tokens.css and brand.json for review.
---

# Brand extraction

Produce a design system from a source someone already has. You are reading an
existing brand, not designing one. Measure what is there; never improve it.

Deliver exactly three files, plus assets:

| File | Purpose |
| --- | --- |
| `DESIGN.md` | The prose contract. Injected verbatim into later `/design` runs. |
| `tokens.css` | Custom properties under `:root`. |
| `brand.json` | Structured summary. Renders the review card. |

Assets: `logo.*`, `favicon.*`, `screenshot-desktop.png`, `screenshot-mobile.png`.

## From a URL

Measure computed styles. Do not read colours off a screenshot — anti-aliasing
and image compression shift them, and a hex that is one digit out produces a
system that looks subtly wrong everywhere it is used.

1. `sandbox-pw-navigate` to the URL. `sandbox-pw-wait-for` the page to settle so
   webfonts have swapped — reading before that yields the fallback stack.
2. `sandbox-pw-evaluate` to walk the rendered DOM and tally real values:

   ```js
   // Count every colour actually painted, with the element it came from.
   const tally = new Map();
   const bump = (map, key, el) => {
     const e = map.get(key) ?? { n: 0, tags: new Set() };
     e.n += 1; e.tags.add(el.tagName.toLowerCase()); map.set(key, e);
   };
   for (const el of document.querySelectorAll('body *')) {
     const cs = getComputedStyle(el);
     const rect = el.getBoundingClientRect();
     if (!rect.width || !rect.height) continue;      // skip hidden nodes
     bump(tally, `color|${cs.color}`, el);
     if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') bump(tally, `bg|${cs.backgroundColor}`, el);
     if (cs.borderTopWidth !== '0px') bump(tally, `border|${cs.borderTopColor}`, el);
   }
   ```

   Gather the same way: `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`,
   `letterSpacing`, `borderRadius`, `boxShadow`, and the margin/padding values
   that repeat.
3. Skip invisible nodes (zero-area, `display:none`, `visibility:hidden`) — they
   carry inherited defaults that are not part of the brand and will otherwise
   dominate the tally.
4. Assign roles from usage, not from appearance:
   - `background` — the colour behind the largest painted area
   - `text` — the `color` of the most body copy
   - `primary` — the colour of primary buttons and links
   - `border`, `surface`, `muted` — as measured
   Leave a role out rather than guessing it.
5. Derive the type scale from headings actually present (`h1`…`h6`) plus body.
   Record measured px, not a theoretical ratio.
6. Capture the logo (`header img`, `[class*=logo]`, or an inline `svg` in the
   header) and the favicon from `link[rel~=icon]`. Capture
   `screenshot-desktop.png` at 1440px wide and `screenshot-mobile.png` at 390px.
7. Follow redirects and record the URL you actually landed on in `sourceUrl`.

## From a screenshot

With no URL, derive the same fields from the attached image. You cannot count
occurrences, so omit `occurrences` rather than inventing a number, and add a
gap: `"colour frequency unavailable — derived from a screenshot"`.

Read colours from large flat regions, not from edges or gradients. State
sizes in px relative to the image's own scale and note that in `gaps` when the
device pixel ratio is unknown.

## Admitting gaps

`brand.json` has a `gaps` array. Use it. Every entry is more useful than a
confident invention, because a wrong token is silently wrong in every artifact
built from it afterwards.

Record a gap when: no webfont file is served, shadows are absent, the logo
cannot be isolated, the page is behind auth or a consent wall, or the spacing
shows no discernible rhythm.

If the page cannot be reached at all — DNS failure, 403, a consent wall you
cannot dismiss — say so plainly and deliver nothing. Do not produce a system
from the error page.

## Output contract

`brand.json` must satisfy `BrandSummary` in
`packages/xyne-claw-shared/src/brand-extraction.ts`. The card validates it and
refuses a payload that does not match, so check before delivering:

- `version` is `1`
- `colors[].hex` is `#RRGGBB`, uppercase, six digits — convert `rgb()` and drop
  alpha
- `colors[].role` is one of `primary`, `accent`, `background`, `surface`,
  `text`, `muted`, `border`, `success`, `warning`, `danger`
- `colors[].token` matches the custom property in `tokens.css` without `--`
- `fonts[].role` is `heading`, `body` or `mono`
- `typeScale[]` entries carry `name` and numeric `sizePx`

`tokens.css` defines every `colors[].token` under `:root` as `--<token>`, plus
type, radii, spacing and shadow values. Name by purpose, not by appearance:
`--brand-primary`, not `--blue-600`.

`DESIGN.md` states the rules a later `/design` run must follow — palette and
when each colour applies, typefaces and the scale, radii, spacing rhythm,
elevation. Write it as binding instructions, not as a description of the site.
Keep it under 32,000 characters: the runtime drops a larger system silently.

End your reply with one short paragraph: the palette, the typefaces, and
anything you could not determine. The files are the deliverable, not the prose.
