-- Narrow the GitHub MCP write-tool allowlist to match
-- backend/src/mcp/adapters/github.ts.
--
-- The original GitHub registration migration
-- (20260513120000_add_github_mcp_server) inserted a writeToolPolicy with
-- 11 write tools. The static adapter now declares only the two that
-- should require explicit confirmation in the UI. Bring the DB row in
-- line so /tools/available and the write-action gating both see the
-- same surface.
--
-- Idempotent: keyed by type='github', no-op if the row is already in
-- this shape or absent.

UPDATE "mcp_servers"
SET
  "writeToolPolicy" = '{"mode":"allowlist","tools":["create_repository","merge_pull_request"]}'::jsonb,
  "updatedAt"       = NOW()
WHERE "type" = 'github';
