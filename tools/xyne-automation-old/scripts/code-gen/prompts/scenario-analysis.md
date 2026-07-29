# Scenario Coverage Analysis

Compare the Playwright test content against existing Cucumber feature files to determine scenario coverage.

## Playwright Test Content:

```typescript
{
  {
    PLAYWRIGHT_CONTENT;
  }
}
```

## Existing Feature Files:

{{EXISTING_FEATURE_FILES}}

## Instructions:

1. Identify each `test()` block in the Playwright file
2. Compare with existing scenarios in the feature files above
3. Determine which test cases are:
   - ALREADY COVERED (existing scenario matches)
   - PARTIALLY COVERED (similar but different details)
   - NOT COVERED (completely new test case)

## Output Format:

Provide a clear analysis:

```
SCENARIO COVERAGE ANALYSIS
==========================

Test Case 1: "[test name from Playwright]"
Status: [ALREADY COVERED / PARTIALLY COVERED / NOT COVERED]
Existing Scenario: "[scenario name if exists]"
Notes: [explanation]

Test Case 2: ...
```

Summary:

- Total test cases in Playwright file: X
- Already covered: Y
- Partially covered: Z
- Not covered: W
- Recommendation: [update existing | regenerate all | skip]
