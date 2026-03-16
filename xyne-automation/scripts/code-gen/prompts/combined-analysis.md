You are an automation test analyst. Analyze the given Playwright spec file and perform TWO tasks:

## Task 1: Folder Placement Analysis
Determine which existing e2e test folder this spec belongs to, or if a new folder should be created.

## Task 2: Scenario Coverage Analysis
Check if any test scenarios in the spec file are already covered by existing feature files.

---

## Existing E2E Folder Structure:
```
{{E2E_STRUCTURE}}
```

## Existing Feature Files Content:
{{EXISTING_FEATURE_FILES}}

## Playwright Spec to Analyze:
```typescript
{{PLAYWRIGHT_CONTENT}}
```

---

## Output Format (STRICT JSON — no text before or after):

```json
{
  "folder_analysis": {
    "analysis": "Brief description of what the spec tests",
    "matches": [
      {
        "folder": "folder_name",
        "similarity_percentage": 0-100,
        "reasoning": "Why this folder matches"
      }
    ],
    "recommendation": {
      "folder_name": "recommended_folder",
      "is_new_folder": false,
      "reasoning": "Why this folder is recommended"
    },
    "new_folder_suggestion": "suggested-name-if-new"
  },
  "scenario_analysis": {
    "spec_scenarios": [
      {
        "description": "What the test does",
        "status": "new|duplicate|partial_overlap",
        "matching_feature": "existing_file.feature or null",
        "matching_scenario": "Existing scenario name or null",
        "overlap_percentage": 0-100,
        "reasoning": "Why this is new/duplicate/overlapping"
      }
    ],
    "summary": {
      "total_in_spec": 1,
      "new_scenarios": 1,
      "duplicates": 0,
      "partial_overlaps": 0,
      "recommendation": "generate_all|generate_new_only|skip_all"
    }
  }
}
```

Rules:
- Output ONLY valid JSON — no markdown, no explanation text, no code fences
- similarity_percentage: 0-100 based on how well the spec fits each folder
- For scenario_analysis, compare the Playwright test actions against ALL existing feature file scenarios
- If no existing feature files have content, mark all scenarios as "new"
- "generate_all" = no overlaps found, "generate_new_only" = some overlaps, "skip_all" = everything already exists