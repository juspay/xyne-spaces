# Xyne Automation — Playwright to BDD Conversion Pipeline

Automated pipeline that converts Playwright spec files into Cucumber BDD (`.feature` + `.steps.ts`) with data-testid management, validation, retry logic, and test execution.

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Pipeline Stages](#pipeline-stages)
- [File Structure](#file-structure)
- [Scripts Reference](#scripts-reference)
- [Backup Files](#backup-files)
- [Troubleshooting](#troubleshooting)

---

## Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                   npm run codegen-and-test                       │
│                  (scripts/code-gen/test-and-run.sh)              │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─── Step 1: data-testid Analysis (LLM-based) ────────────┐   │
│  │  LLM analyzes spec + dashboard source                     │   │
│  │    ├─ Reads Playwright spec for button selectors          │   │
│  │    ├─ Scans dashboard/src for matching components         │   │
│  │    ├─ LLM suggests where to add data-testid attributes    │   │
│  │    └─ Updates spec: getByRole → getByTestId               │   │
│  └───────────────────────────────────────────────────────────┘   │
│        │                                                         │
│        ▼                                                         │
│  ┌─── Step 2: BDD Conversion ───────────────────────────────┐   │
│  │  npm run codegen (scripts/code-gen/test-automate.sh)     │   │
│  │    ├─ LLM decides output folder (or name-based fallback)  │   │
│  │    ├─ Saves prompt to llm_reports/prompts/                │   │
│  │    ├─ Sends spec file + prompt to LLM (with live timer)   │   │
│  │    ├─ Parses LLM output for code blocks                   │   │
│  │    ├─ Always names files using BASE_NAME from spec        │   │
│  │    └─ Writes .feature + .steps.ts files                   │   │
│  └───────────────────────────────────────────────────────────┘   │
│        │                                                         │
│        ▼                                                         │
│  ┌─── Step 3: Validation (Dry Run) ─────────────────────────┐   │
│  │  npx cucumber-js --dry-run                                │   │
│  │    ├─ Checks for undefined steps                          │   │
│  │    ├─ Checks for TypeScript errors                        │   │
│  │    ├─ Checks for ambiguous/duplicate steps                │   │
│  │    ├─ On failure → saves report → retries (up to 2x)     │   │
│  │    └─ Retry sends failure report to LLM for correction    │   │
│  └───────────────────────────────────────────────────────────┘   │
│        │                                                         │
│        ▼                                                         │
│  ┌─── Step 4: Test Execution ───────────────────────────────┐   │
│  │  npm run test:e2e                                         │   │
│  │    ├─ Runs full Cucumber test suite                       │   │
│  │    └─ 4-hour timeout                                      │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

```bash
# Convert a single Playwright spec to BDD and run tests
npm run codegen-and-test -- tests/actions/test-1.spec.ts

# Convert multiple specs
npm run codegen-and-test -- tests/actions/test-1.spec.ts tests/actions/thread.spec.ts

# Run only the BDD conversion (no testid analysis, no test execution)
npm run codegen -- tests/actions/test-1.spec.ts

# Clean up all generated backup/report files (keeps spec, feature, steps)
npm run codegen-cleanup
```

---

## Pipeline Stages

### Stage 1: data-testid Analysis & Insertion (LLM-based)

**Entry point:** Built into `scripts/code-gen/test-and-run.sh`
**Trigger:** Runs automatically for each spec file

#### What it does:

1. **Reads Playwright spec** — extracts button selectors (`getByRole('button', ...)`, `getByText(...)`, etc.)
2. **Scans dashboard source** — locates matching React/JSX components in `dashboard/src`
3. **LLM analysis** — sends the spec + component context to the LLM, which suggests:
   - Where to add `data-testid` attributes in dashboard components
   - What testid names to use (kebab-case, descriptive)
4. **Updates spec file** — replaces `getByRole('button', { name: '...' })` → `getByTestId('...')` in the Playwright spec

#### Flow control:

- **Runs automatically** for each spec file
- **Blocks:** Step 2 does not start until this completes

---

### Stage 2: BDD Conversion

**Entry point:** `scripts/code-gen/test-automate.sh`
**Trigger:** Automatically after Stage 1 completes (or immediately if user skips Stage 1)

#### What it does:

1. Reads the Playwright spec file
2. **Folder decision:** Asks LLM to pick the best e2e folder (or creates a new one). Falls back to name-based lookup if LLM fails. Debug output saved to `llm_reports/folder_decisions/`.
3. Constructs a prompt with:
   - Existing shared step definitions (for reuse)
   - Existing e2e test examples
   - Strict rules for output format (CSS selector style testids, code block requirements)
4. Saves prompt to `llm_reports/prompts/` for debugging
5. Sends to LLM (configured model) with live elapsed timer
6. Parses LLM output for code blocks (`.feature` and `.steps.ts`)
7. **Always uses `BASE_NAME`** (from the spec filename) for generated filenames — e.g., `test-1.spec.ts` → `NN_test-1.feature` + `NN_test-1.steps.ts`
8. Writes files to `tests/03_e2e/<folder>/`
9. Logs start time, end time, elapsed time, and exit code to `llm_reports/llm_output_debug/`

#### Key LLM prompt rules:

- **ALWAYS output code blocks** (even if similar tests exist)
- Use `I click on "[data-testid='...']"` format (NOT `I click the element with testid`)
- Reuse shared step definitions where possible
- Do not re-define steps that exist in `tests/shared/common.steps.ts`

#### File discovery (test-and-run.sh):

- After conversion, `test-and-run.sh` finds generated files by searching `tests/03_e2e/` for `*<BASE_NAME>*.feature` and `*<BASE_NAME>*.steps.ts`
- No manifest files are used — discovery is purely by filename pattern matching
- `BASE_NAME` is derived from the spec file (e.g., `test-1.spec.ts` → `test-1`)

#### Flow control:

- **Waits for:** Stage 1 to complete
- **Blocks:** Stage 3 waits for all files to be generated

---

### Stage 3: Validation (Dry Run)

**Entry point:** Built into `test-and-run.sh`
**Trigger:** Automatically after each file is converted in Stage 2

#### What it does:

1. Runs `npx cucumber-js --dry-run` against the generated feature file
2. Checks for:
   - **Undefined steps** — steps in `.feature` with no matching step definition
   - **TypeScript errors** — compilation failures in `.steps.ts`
   - **Ambiguous steps** — duplicate step definitions (e.g., redefined shared steps)
3. On failure:
   - Saves failure report to `llm_reports/dry_run/`
   - Backs up failed files to `_previous/` folder with attempt suffix
   - Retries by re-sending to LLM with the failure report attached
   - Up to **2 retries** (3 total attempts)

#### Flow control:

- **Waits for:** Stage 2 to produce `.feature` + `.steps.ts` files
- **Retries:** Up to 2 times on dry run failure
- **Blocks:** Stage 4 does not start until all files pass validation

---

### Stage 4: Test Execution

**Entry point:** `npm run test:e2e`
**Trigger:** Automatically after all validations pass

#### What it does:

- Runs the full Cucumber e2e test suite
- 4-hour maximum timeout
- Shows live spinner with elapsed time

#### Flow control:

- **Waits for:** All files to pass dry run validation
- **Does NOT run if:** Any conversion or validation failed

---

## File Structure

```
xyne-automation/
├── scripts/
│   ├── code-gen/
│   │   ├── test-and-run.sh          # Main orchestrator
│   │   ├── test-automate.sh         # Stage 2: LLM-based BDD conversion
│   │   ├── add-testid-llm.sh        # LLM-based testid addition
│   │   ├── cleanup.sh               # Cleanup script
│   │   └── setup.sh                 # Setup script
│   └── .env                         # API keys (JUSPAY_API_KEY)
│
├── tests/
│   ├── actions/                  # Original Playwright spec files
│   │   ├── test-1.spec.ts
│   │   └── test-1_original.spec.ts    # ← Backup before testid replacement
│   │
│   ├── 03_e2e/                   # Generated BDD tests
│   │   ├── e2e-common.steps.ts
│   │   └── 10_test-1/
│   │       ├── 04_test-1.feature
│   │       ├── steps/
│   │       │   └── 05_test-1.steps.ts
│   │       └── _previous/        # ← Failed attempt backups
│   │           ├── 04_test-1_attempt_00.feature.txt
│   │           └── 05_test-1_attempt_00.steps.ts.txt
│   │
│   └── shared/
│       └── common.steps.ts       # Shared step definitions (reused by all tests)
│
└── llm_reports/
    ├── llm_output_debug/         # Raw LLM responses (with start/end time, elapsed, exit code)
    │   └── test-1_20260213_173754.txt
    ├── folder_decisions/         # LLM folder decision debug output
    │   └── test-1_folder_decision_20260213_173700.log
    ├── prompts/                  # Full prompts sent to LLM (for debugging)
    │   └── test-1_prompt_20260213_173710.txt
    ├── conversion_logs/          # Full conversion script logs
    │   └── test-1_conversion_20260213_174000.log
    └── dry_run/                  # Failed dry run reports
        └── test-1_failed_dry_run_20260213_174500.txt
```

---

## Backup Files

| File                        | Location                                 | Purpose                                                                                                                                                |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test-1_original.spec.ts`   | `tests/actions/`                         | Original Playwright spec before `getByRole` → `getByTestId` replacement. Allows reverting spec changes.                                                |
| `*_attempt_00.feature.txt`  | `tests/03_e2e/<folder>/_previous/`       | Failed feature file from retry attempt 0. Kept for debugging LLM output issues. Uses `.txt` extension to prevent cucumber from picking it up.          |
| `*_attempt_00.steps.ts.txt` | `tests/03_e2e/<folder>/steps/_previous/` | Failed steps file from retry attempt 0. Same reason as above.                                                                                          |
| `*_conversion_*.log`        | `llm_reports/conversion_logs/`           | Full stdout/stderr from the conversion script run. Useful for debugging LLM connection issues, timeouts.                                               |
| `*_failed_dry_run_*.txt`    | `llm_reports/dry_run/`                   | Dry run failure report containing: command ran, cucumber output, undefined/ambiguous step details. Sent to LLM on retry for self-correction.           |
| `test-1_*.txt`              | `llm_reports/llm_output_debug/`          | Raw LLM response text with start/end timestamps, elapsed time, model, and exit code. Used to debug what the LLM actually generated vs what was parsed. |
| `*_folder_decision_*.log`   | `llm_reports/folder_decisions/`          | LLM folder decision debug output. Contains exit code, timestamp, and raw LLM response for the folder selection call.                                   |
| `*_prompt_*.txt`            | `llm_reports/prompts/`                   | Full prompt sent to the LLM. Useful for debugging prompt construction, missing context, or rule issues.                                                |

---

## Scripts Reference

### `test-and-run.sh`

Main orchestrator. Runs all 4 stages in sequence.

```bash
npm run codegen-and-test -- <spec-file.spec.ts> [<spec-file2.spec.ts> ...]
```

**Key behaviors:**

- Automatically runs testid analysis for each spec file
- Runs conversion in background with live spinner + phase detection
- Validates each generated file with dry run
- Retries failed conversions up to 2 times
- Exits early if any conversion/validation fails
- 4-hour timeout for test execution (configurable via `print_live_time` 5th arg)

### `test-automate.sh`

Sends spec file to LLM for BDD conversion.

```bash
npm run codegen -- <spec-file.spec.ts>
```

**Key behaviors:**

- LLM folder decision with fallback to name-based lookup (`*_<BASE_NAME>`)
- Folder decision debug saved to `llm_reports/folder_decisions/`
- Full prompt saved to `llm_reports/prompts/` for debugging
- Live elapsed timer during LLM call (updates every second)
- Start/end time, elapsed, exit code logged to `llm_reports/llm_output_debug/`
- Always uses `BASE_NAME` for generated filenames (ignores LLM-suggested names)
- Detects existing files in target folder and prompts: Skip / Add new / Regenerate all

---

## Troubleshooting

### LLM folder decision failed

The LLM couldn't decide which folder to place generated files in. The script falls back to name-based lookup (`*_<BASE_NAME>`). Check `llm_reports/folder_decisions/` for the raw LLM response and exit code.

### "No component files found" for a button

The button text may be:

- **Split across JSX elements** — e.g., `Open My Workspace` + `<span>→</span>`. The LLM handles this by analyzing the component context, but unusual splits may need manual testid addition.
- **Dynamic/conditional** — e.g., `{isLoading ? 'Loading...' : 'Submit'}`. Add `data-testid` manually and re-run.
- **In a different project** — text rendered by a package or micro-frontend.

### LLM says "test already exists"

The LLM prompt now explicitly requires code block output even if similar tests exist. If this still happens, check `llm_reports/llm_output_debug/` for the raw response.

### Generated files not found after conversion

`test-and-run.sh` searches `tests/03_e2e/` for `*<BASE_NAME>*.feature` and `*<BASE_NAME>*.steps.ts`. If the LLM chose a different filename (e.g., `dm-flow` instead of `test-1`), files won't be found. The script now always forces `BASE_NAME` for filenames to prevent this.

### LLM returned empty steps file

If the LLM outputs an empty `typescript` code block, the script creates a minimal `.steps.ts` file with just imports. Check `llm_reports/llm_output_debug/` for the raw response to see what the LLM actually returned.

### Dry run fails with "undefined steps"

The LLM generated step phrases that don't match any step definition. The pipeline auto-retries with the failure report. If it still fails after 2 retries, manually fix the `.steps.ts` file.

### Dry run fails with "ambiguous steps"

The generated `.steps.ts` re-defines a step that already exists in `tests/shared/common.steps.ts`. Remove the duplicate from the generated file.

### Timeout during test execution

Default timeouts:

- **LLM conversion**: 10 minutes (`API_TIMEOUT_MS=600000`)
- **Validation retries**: 20 minutes each
- **Test execution**: 4 hours

If any stage exceeds its timeout, the process is terminated. Check for:

- Hanging browser instances
- Network connectivity issues
- LLM API downtime (for conversion timeout)
- Elements not found (missing testids)

### Debugging a failed run

1. **Folder decision failed?** → `cat llm_reports/folder_decisions/<name>_folder_decision_*.log`
2. **What prompt was sent?** → `cat llm_reports/prompts/<name>_prompt_*.txt`
3. **What did the LLM return?** → `cat llm_reports/llm_output_debug/<name>_*.txt`
4. **Dry run failed?** → `cat llm_reports/dry_run/<name>_failed_dry_run_*.txt`
5. **Full conversion log?** → `cat llm_reports/conversion_logs/<name>_conversion_*.log`
