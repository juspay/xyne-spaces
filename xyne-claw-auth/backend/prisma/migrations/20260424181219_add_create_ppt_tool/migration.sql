-- Seed the create-ppt custom tool. Implementation lives in
-- xyne-claw-shared/src/tools/create-ppt and runs inside xyne-claw.
INSERT INTO "tools" ("id", "slug", "name", "description", "source", "inputSchema", "enabled", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'create-ppt',
  'Create Presentation',
  'Generate a PowerPoint (.pptx) presentation from a brief. The tool calls an LLM to design slide JSON, renders it with pptxgenjs, and returns the file as an attachment. Provide a rich brief (topic, purpose, audience, tone, key points) and the number of slides (3–20).',
  'custom:create-ppt',
  '{
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Rich presentation brief: topic, purpose, audience, tone, key content points, color/style preferences, and any specific slides or data to include."
      },
      "num_slides": {
        "type": "integer",
        "minimum": 3,
        "maximum": 20,
        "description": "Number of slides to generate (typically 8–12; default 10)."
      }
    },
    "required": ["query", "num_slides"]
  }'::jsonb,
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "source" = EXCLUDED."source",
  "inputSchema" = EXCLUDED."inputSchema",
  "updatedAt" = NOW();
