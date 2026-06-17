# Dead Code Analyzer

Knip-based dead code removal toolkit for the Xyne Spaces monorepo.

## Prerequisites

```bash
cd scripts/deadcode-analyzer
npm install
```

This installs `ts-morph` locally so the AST-based declaration remover works without touching workspace `package.json` files.

## Tools

### `knip_reporter.py`

Preview what Knip considers unused for a given feature area.

```bash
# Basic report (table format)
python3 scripts/deadcode-analyzer/knip_reporter.py project,boards

# Restrict to dashboard workspace
python3 scripts/deadcode-analyzer/knip_reporter.py project,boards --workspace=dashboard

# Markdown output (good for copy-paste into tickets)
python3 scripts/deadcode-analyzer/knip_reporter.py project,boards --format=markdown

# Clear cache and regenerate
python3 scripts/deadcode-analyzer/knip_reporter.py project,boards --clear-cache
```

Categories shown: unused files, exports, types, enum members, dependencies, devDependencies, duplicates.

### `knip_remover.py`

Actually remove dead code. **Always `--dry-run` first.**

```bash
# Preview all removals (no changes made)
python3 scripts/deadcode-analyzer/knip_remover.py project,boards --workspace=dashboard --dry-run

# Live removal with automatic tsc cleanup
python3 scripts/deadcode-analyzer/knip_remover.py project,boards --workspace=dashboard

# Skip the tsc auto-fix loop (handle barrels manually)
python3 scripts/deadcode-analyzer/knip_remover.py project,boards --workspace=dashboard --skip-tsc

# Limit tsc iterations (default 10)
python3 scripts/deadcode-analyzer/knip_remover.py project,boards --workspace=dashboard --tsc-max-iterations=5

# Clear cached Knip results
python3 scripts/deadcode-analyzer/knip_remover.py project,boards --workspace=dashboard --clear-cache
```

#### What gets removed

- **Files** — deleted outright
- **Exports** — `export const`, `export function`, `export default`, `export interface`, `export type` removed via ts-morph AST manipulation
- **Types** — same as exports (ts-morph handles interfaces, type aliases, enums)
- **Dependencies** — removed from `package.json` (`dependencies`, `devDependencies`, `peerDependencies`)

#### Automatic tsc cleanup

After live removal, the tool runs `tsc --noEmit` and auto-fixes cascading errors:

| Error | Action |
|---|---|
| TS2305 | Remove stale re-exports from barrel `index.ts` |
| TS2724 | Same as TS2305 ("Did you mean...?" variant) |
| TS2307 | Remove re-exports pointing to deleted files |
| TS6133 | Remove unused import specifiers |
| TS6192 | Remove entirely unused import declarations |
| TS6196 | Remove unused types/interfaces via ts-morph |

Loops until convergence (max 10 rounds).

#### Post-removal empty cleanup

After tsc converges, the tool deletes:
- Empty `.ts`/`.tsx` files (0 bytes or whitespace-only)
- Parent directories that become empty

Scoped to the workspace `src/` — never touches `node_modules/` or `dist/`.

## How it works

```
Python orchestration (knip_reporter.py / knip_remover.py)
        │
        ├──► Runs Knip via npx (cached to .knip_cache.json)
        │
        ├──► Filters results by feature keywords + workspace
        │
        ├──► For exports/types: calls ts-morph helper
        │           node scripts/deadcode-analyzer/remove-declaration.cjs
        │           (AST-based removal, handles multi-line declarations)
        │
        └──► Post-removal: runs tsc loop via tsc_cleanup.py
                    (auto-fixes barrels, imports, unused declarations)
```

### Why ts-morph?

Writing a regex/parser to handle multi-line `export const`, arrow functions with generics, `export default`, and mixed declarations is fragile. `ts-morph` parses the actual AST and removes the precise declaration node, handling edge cases like:

- Multi-line `export const FOO = [...]` spanning 10 lines
- `export default Component` on a different line from the component
- Mixed declaration lists: `export const A = 1, B = 2;`

### ts-morph helper

`remove-declaration.cjs` accepts:

```bash
node remove-declaration.cjs \
  --tsconfig dashboard/tsconfig.json \
  --file dashboard/src/foo.ts \
  --symbol MyComponent \
  --line 42
```

Works with any workspace by passing the correct `--tsconfig`.

## File structure

```
scripts/deadcode-analyzer/
├── knip_reporter.py          # Report generator
├── knip_remover.py           # Live removal + tsc loop
├── tsc_cleanup.py            # tsc error auto-fixer
├── remove-declaration.cjs    # ts-morph AST helper
├── package.json              # Local ts-morph dependency
└── node_modules/             # Local npm install
```

## Safety

- `--dry-run` is the default preview mode; live removal requires omitting the flag
- `tsc --noEmit` runs after every live removal to validate
- Only auto-fixes errors in files that were modified by the tool (or their barrels)
- Git provides easy revert if something goes wrong

## Known limitations

- `knip.jsonc` ignores `**/index.ts` globally to reduce barrel-file false positives. This means some re-exports in barrels won't be reported as unused by Knip — the tsc cleanup catches them after removal instead.
- Lazy-loaded routes must be listed as Knip entry points (already done for dashboard in `knip.jsonc`).
- The tool processes all removable categories together; there is no `--category` flag.
