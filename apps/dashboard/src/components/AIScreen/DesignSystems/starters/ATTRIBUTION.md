# Starter design systems — attribution

The files in `open-design/` are copied **verbatim** from the Open Design project
and are redistributed here under the Apache License 2.0.

|         |                                                                          |
| ------- | ------------------------------------------------------------------------ |
| Project | Open Design                                                              |
| Source  | https://github.com/nexu-io/open-design                                   |
| Path    | `design-systems/<name>/DESIGN.md` and `design-systems/<name>/tokens.css` |
| Licence | Apache-2.0 — full text in `open-design/LICENSE`                          |

## What was taken

Four of the 152 packages in that directory, chosen because they describe a
visual style rather than a company:

| File prefix | Upstream package           | Shown as          |
| ----------- | -------------------------- | ----------------- |
| `modern`    | `design-systems/modern`    | Modern SaaS       |
| `mono`      | `design-systems/mono`      | Minimal Mono      |
| `vibrant`   | `design-systems/vibrant`   | Vibrant Tech      |
| `editorial` | `design-systems/editorial` | Classic Editorial |

The upstream directory also holds packages named after real companies — `apple`,
`nike`, `stripe`, `ferrari` and others. Those are deliberately **not** included:
the Apache licence covers the files, but it does not grant any right to the
trademarks they describe, and a gallery offering users an "Apple" starter would
imply an endorsement that does not exist.

## What was changed

The file **contents** are byte-for-byte as published. Two things about the
packaging differ:

- `tokens.css` is stored as `<name>.tokens.css.txt`. Vite's CSS pipeline returns
  an empty string for a `.css?raw` import, so the bundler has to be told these
  are text. Only the extension differs.
- These files are listed in `.prettierignore`. Formatting them to our own style
  would modify someone else's licensed file and break the claim above.

The display names in the table come from `index.ts` and are ours, not
upstream's.

Adding more packages means copying the same two files from the same upstream
path and adding a row to `STARTER_SYSTEMS` — no transformation step.
