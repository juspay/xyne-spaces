-- Seed the edit-ppt custom tool. Companion to create-ppt; takes the slide
-- JSON returned by a prior create-ppt/edit-ppt call plus a change request
-- and re-renders the deck. Implementation lives in
-- xyne-claw-shared/src/tools/create-ppt and runs inside xyne-claw.
INSERT INTO "tools" ("id", "slug", "name", "description", "source", "inputSchema", "enabled", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'edit-ppt',
  'Edit Presentation',
  'Modify an existing presentation''s slide JSON and re-render. Pass the previous slide JSON (returned by create-ppt or a prior edit-ppt call, between SLIDE_JSON_START/SLIDE_JSON_END) plus a plain-language change request. The tool preserves unrelated slides/elements and only changes what was requested.',
  'custom:create-ppt',
  '{
    "type": "object",
    "properties": {
      "previous_slides_json": {
        "type": "string",
        "description": "The complete slide JSON from a previous create-ppt or edit-ppt tool result. Copy the JSON object verbatim (from between SLIDE_JSON_START and SLIDE_JSON_END)."
      },
      "change_request": {
        "type": "string",
        "description": "Plain-language description of the change: e.g. ''make slide 3 shorter'', ''add a quote slide before closing'', ''change theme to Ocean Gradient''."
      },
      "num_slides": {
        "type": "integer",
        "minimum": 3,
        "maximum": 20,
        "description": "Optional — final number of slides after edit (only needed if adding/removing slides)."
      }
    },
    "required": ["previous_slides_json", "change_request"]
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
