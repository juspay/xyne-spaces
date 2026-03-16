# Xyne Codegen — Available Commands
# ====================================

# ── Full Pipeline (testids → analysis → convert → dry-run → test) ──
npm run codegen -- convert tests/actions/test-1.spec.ts

# ── Skip testid addition only ──
npm run codegen -- convert:skip-testids tests/actions/test-1.spec.ts

# ── Skip folder analysis (auto-pick folder by spec name) ──
npm run codegen -- convert:skip-folder tests/actions/test-1.spec.ts

# ── Skip scenario duplicate analysis (always regenerate) ──
npm run codegen -- convert:skip-scenario tests/actions/test-1.spec.ts

# ── Skip testids + analysis (conversion only) ──
npm run codegen -- convert:skip-all tests/actions/test-1.spec.ts

# ── Skip testids + analysis + specify folder ──
npm run codegen -- convert:skip-all --retry-folder 06_canvas tests/actions/test-1.spec.ts

# ── Skip all LLM analyses + testid addition (only conversion LLM runs) ──
npm run codegen -- convert:skip-everything tests/actions/test-1.spec.ts
npm run codegen -- convert:skip-everything --retry-folder 06_canvas tests/actions/test-1.spec.ts

# ── Retry with dry-run report (re-generates steps only) ──
npm run codegen -- convert --skip-testids --skip-analysis --retry-folder 06_canvas --dry-run-report /path/to/report.txt tests/actions/test-1.spec.ts

# ── Analysis Only (folder + scenario in single LLM call, no conversion) ──
npm run codegen -- analyze tests/actions/test-1.spec.ts                          # all folders
npm run codegen -- analyze 04_messages tests/actions/test-2.spec.ts              # scoped to folder

# ── Individual Analysis ──
npm run codegen -- folder-analysis tests/actions/test-1.spec.ts
npm run codegen -- scenario-analysis 06_canvas tests/actions/test-1.spec.ts

# ── Add TestIDs Only ──
npm run codegen -- add-testids tests/actions/test-1.spec.ts ../dashboard/src

# ── Cleanup Generated Files ──
npm run codegen -- cleanup

# ── Help ──
npm run codegen -- help

# ── Options (for convert commands) ──
# --dry-run-report <file>    Use dry-run failure report to fix previous attempt
# --retry-folder <folder>    Specify folder explicitly for retry

# ── Skip flags (can be combined with convert) ──
# npm run codegen -- convert:skip-all tests/actions/test-1.spec.ts          # skip testid + folder + scenario analysis
# npm run codegen -- convert:skip-testids tests/actions/test-1.spec.ts      # skip testid addition

# ── Shorthand npm scripts ──
npm run codegen:skip-all -- tests/actions/test-1.spec.ts          # same as convert:skip-all
npm run codegen:skip-folder -- tests/actions/test-1.spec.ts       # skip folder analysis
npm run codegen:skip-scenario -- tests/actions/test-1.spec.ts     # skip scenario analysis
npm run codegen:folder-analysis -- tests/actions/test-1.spec.ts
npm run codegen:scenario-analysis -- tests/actions/test-1.spec.ts
npm run codegen:add-testids -- tests/actions/test-1.spec.ts ../dashboard/src
npm run codegen-and-test -- tests/actions/test-1.spec.ts          # full pipeline
npm run codegen-cleanup

# ── Run Tests Directly ──
npm run test:e2e                                                   # all e2e tests
npx cucumber-js tests/03_e2e/06_canvas/01_test-1.feature --profile e2e  # specific feature
npx cucumber-js --dry-run tests/03_e2e/06_canvas/01_test-1.feature --profile e2e  # dry-run only