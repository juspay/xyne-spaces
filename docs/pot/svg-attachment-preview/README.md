# POT: SVG attachment safe preview

This folder is direct PR evidence for safe SVG attachment previews.

## Artifacts

- `index.html` — visual POT report.
- `safe-svg-thumbnail.png` — PNG thumbnail generated from a safe SVG.
- `result.json` — machine-readable result from the POT script.
- `generate-pot.mjs` — deterministic script used to generate the artifacts.

## Validation

Commands run in sandbox:

```bash
NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter xyne-spaces-backend typecheck
NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter xyne-spaces-dashboard typecheck
node docs/pot/svg-attachment-preview/generate-pot.mjs
```

Result:

- Safe SVG converts to PNG thumbnail.
- Scripted SVG with external image reference is rejected before conversion.
- Original SVG download path is not made inline-renderable by this change.
