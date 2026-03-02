# Folder Placement Analysis

Analyze the existing e2e test structure and recommend the best folder for this new Playwright test.

## Existing E2e Structure:

{{E2E_STRUCTURE}}

## Playwright Test Content:

```typescript
{{PLAYWRIGHT_CONTENT}}
```

## Instructions:

1. Analyze what this Playwright test does (feature, functionality)
2. Compare with existing scenarios in the structure above
3. Identify which existing folder (if any) covers similar functionality
4. Calculate similarity percentages based on:
   - Feature domain (chat, tickets, calls, settings, etc.)
   - UI components used (sidebars, modals, forms, etc.)
   - User actions (create, edit, delete, search, etc.)
   - Data entities involved (channels, messages, users, etc.)

## Output Format:

Return a JSON response with this structure:

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
    "reasoning": "Why this is the best choice"
  },
  "new_folder_suggestion": "suggested-name-if-no-match"
}
```

- If no good match exists, suggest creating a new folder with `new_folder_suggestion`
- Provide similarity percentages for top 3 matching folders (0-100%)
- Always include at least one recommendation
