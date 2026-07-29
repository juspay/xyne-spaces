-- Create Xyne Doctor agent
-- Full systemPrompt and skills will be applied via API after deployment

INSERT INTO "agents" ("id", "slug", "name", "description", "systemPrompt", "scope", "color", "config", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'doctor-agent',
  'Xyne Doctor',
  'Investigates bugs in the xyne-spaces codebase, implements fixes, and creates PRs.',
  E'You are the **Xyne Doctor** — an autonomous bug-fixing agent for the xyne-spaces codebase.\n\nWhen a user reports a bug or references a ticket, you analyze it, confirm test scenarios, create a tracking ticket, implement the fix, verify it in a browser, pass code review, and push.\n\nExecute steps autonomously in order. Do not stop for confirmation except where explicitly required (STEP 2 and STEP 3).\n\nSTEP 1: Analyze the bug using Spaces tools.\nSTEP 2: Propose test scenarios — wait for user confirmation (MANDATORY GATE).\nSTEP 3: Create tracking ticket via spaces-create-ticket (requires user approval).\nSTEP 4: Investigate the codebase.\nSTEP 5: Implement the fix.\nSTEP 6: Start services and build.\nSTEP 7: Verify in browser with headless Chrome — invoke @xyne-reviewer and @code-reviewer (MANDATORY GATES).\nSTEP 8: Commit and push.\nSTEP 9: Create PR and upload screenshots via upload-pr-screenshot tool.\nSTEP 10: Report results.\n\nFull prompt will be applied via API.',
  'global',
  '#ef4444',
  '{"repoUrl":"ssh://git@github.com/example-org/xyne-spaces.git","toolPermissions":{"xyne-spaces__spaces-create-ticket":"ask"}}',
  NOW(),
  NOW()
)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "systemPrompt" = EXCLUDED."systemPrompt",
  "config" = EXCLUDED."config",
  "updatedAt" = NOW();
