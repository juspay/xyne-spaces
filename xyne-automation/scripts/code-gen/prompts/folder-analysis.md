# Folder Placement Analysis

Analyze the existing e2e test structure and recommend the best folder for this new Playwright test.

## Existing E2E Structure:

{{E2E_STRUCTURE}}

## Playwright Test Content:

```typescript
{{PLAYWRIGHT_CONTENT}}
```

## Instructions:

1. Analyze what this Playwright test does (feature, functionality, domain)
2. Compare with existing folders/scenarios in the structure above
3. Identify which existing folder (if any) covers similar functionality
4. Calculate similarity percentages based on:
   - Feature domain (e.g., chat, canvas, tickets, calls, settings, admin, etc.)
   - UI components involved (e.g., sidebars, modals, forms, editors, lists, etc.)
   - User actions performed (e.g., create, edit, delete, search, navigate, etc.)
   - Data entities involved (e.g., channels, messages, users, documents, etc.)
5. If no existing folder has **≥ 70% similarity**, always recommend creating a new folder

## Output Format:

Return ONLY a valid JSON response (no markdown fences, no extra text) with this structure:

```json
{
  "analysis": "Brief description of what the test does",
  "matches": [
    {
      "folder": "folder-name",
      "similarity_percentage": 85,
      "reasoning": "Why this folder matches"
    }
  ],
  "recommendation": {
    "folder_name": "recommended-folder",
    "is_new_folder": false,
    "reasoning": "Why this is the best choice"
  },
  "new_folder_suggestion": "suggested-folder-name-if-no-good-match"
}
```

### Output Rules:
- `matches`: Top 3 existing folders ranked by similarity (0–100%). May be empty if structure is empty.
- `recommendation.folder_name`: The single best folder (existing or new).
- `recommendation.is_new_folder`: Set `true` if recommending a new folder, `false` if using an existing one.
- `new_folder_suggestion`: Always provide a sensible new folder name derived from the test's domain/feature. If an existing folder is recommended, this serves as a fallback.
- If the best match is **< 70%**, set `recommendation.folder_name` to the value of `new_folder_suggestion` and `is_new_folder` to `true`.
- The JSON must be parseable. Do not wrap it in markdown code fences or add commentary outside the JSON.
