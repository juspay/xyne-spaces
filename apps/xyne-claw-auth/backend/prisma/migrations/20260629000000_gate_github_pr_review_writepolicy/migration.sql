-- Gate the GitHub MCP `create_pull_request_review` tool behind write-action
-- approval.
--
-- Background: an autonomous reviewer agent was submitting PR reviews
-- (event = REQUEST_CHANGES / APPROVE) via `create_pull_request_review`, which
-- changes the PR review state ("Changes requested" / approved) without any
-- confirmation. That tool was NOT in the github writeToolPolicy — the last
-- change (20260514120000_update_github_write_tools) narrowed the allowlist to
-- ["create_repository","merge_pull_request"] — so the review submission ran
-- silently via /mcp/call.
--
-- Adding it to the allowlist makes resolveConnectorDefinition() expose it as a
-- write tool, which forces permission = "ask" at /mcp/call. The call is then
-- intercepted and returned as a signed pendingAction ("Action queued for
-- approval") instead of executing, so an unattended agent can no longer set PR
-- review state without a human approving.
--
-- Scope note: this is the GLOBAL github connector row, shared by every agent
-- and user. After this migration, ANY GitHub agent that submits a PR review
-- will require approval (this includes APPROVE/COMMENT, not just
-- REQUEST_CHANGES — writeToolPolicy gates at the tool level, not the event
-- level).
--
-- Idempotent: keyed by type = 'github'; only appends when mode = 'allowlist'
-- and the tool is not already present. No-op if the row is absent or already
-- gated.

UPDATE "mcp_servers"
SET
  "writeToolPolicy" = jsonb_set(
    COALESCE("writeToolPolicy", '{"mode":"allowlist","tools":[]}'::jsonb),
    '{tools}',
    COALESCE("writeToolPolicy" -> 'tools', '[]'::jsonb) || '["create_pull_request_review"]'::jsonb,
    true
  ),
  "updatedAt" = NOW()
WHERE "type" = 'github'
  AND COALESCE("writeToolPolicy" ->> 'mode', 'allowlist') = 'allowlist'
  AND NOT COALESCE("writeToolPolicy" -> 'tools', '[]'::jsonb) @> '["create_pull_request_review"]'::jsonb;
