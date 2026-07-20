# @xyne/icons

Pikaicons v2.1 as themeable React components. Every icon ships in **5 styles** —
`Stroke`, `Solid`, `Contrast`, `Duo Stroke`, `Duo Solid` — from a single component.

## Usage

```tsx
import { Ai01 } from "@xyne/icons";

<Ai01 />                                      // Stroke, 24px, inherits text color
<Ai01 variant="Solid" />
<Ai01 variant="Duo Solid" size={32} color="#6d28d9" />
<Ai01 variant="Contrast" strokeWidth={1.5} className="opacity-80" />
```

Props: `variant` (style), `size`, `color`, `strokeWidth`, `absoluteStrokeWidth`,
plus any native `<svg>` prop (`onClick`, `aria-label`, …). Passing `aria-label`
drops the default `aria-hidden`.

Color is driven by `currentColor`: both tones of the duo/contrast styles inherit
the same `color`, with the secondary tone at reduced opacity — so one `color`
prop themes the whole icon.

## How it works

- **`src/types.ts`** — `IconNode` (`[tag, attrs][]`), the `PikaStyle` union, `IconVariants`.
- **`src/createPikaIcon.tsx`** — one factory + renderer. Builds the `<svg>` from
  shared defaults, applies `size`/`color`/`strokeWidth`, and maps the selected
  variant's nodes to child elements. `fill`/`stroke`/`strokeWidth` are set once on
  the root and inherited by every path.
- **`src/icons/*.ts`** — auto-generated, one file per icon: an `IconVariants`
  object fed to `createPikaIcon`.

## Adding icons (the pipeline)

```
svg/<icon-name>/<Style>.svg      raw Figma exports, 5 per icon:
                                 Stroke / Solid / Contrast / DuoStroke / DuoSolid
        │  npm run build:icons
        │    · keep only the <g id="Style=…"> subtree (drop artboard chrome)
        │    · flatten to [tag, attrs] tuples, propagate group opacity
        │    · #111111 → currentColor, strip inherited stroke-* attrs
        ▼
src/icons/<icon-name>.ts   +   src/index.ts (barrel, regenerated)
        │  npm run build   (tsc → dist, ESM + .d.ts)
        ▼
consumed via  "@xyne/icons": "file:../icons"
```

1. Export the icon's 5 styles from Figma as SVG into `svg/<icon-name>/`
   (filenames: `Stroke.svg`, `Solid.svg`, `Contrast.svg`, `DuoStroke.svg`, `DuoSolid.svg`).
2. `npm run build:icons` regenerates `src/icons/` and the barrel.
3. `npm run build` compiles to `dist/`.

The icon folder name becomes the component name (`ai-01` → `Ai01`).
