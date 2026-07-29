DELETE FROM "agent_tools"
WHERE "toolId" IN (SELECT "id" FROM "tools" WHERE "slug" = 'claw-builtin__webfetch');

DELETE FROM "tools"
WHERE "slug" = 'claw-builtin__webfetch';
