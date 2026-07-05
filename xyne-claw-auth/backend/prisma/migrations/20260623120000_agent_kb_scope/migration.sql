-- Add KB scoping mode to agents.
--   "COLLECTIONS" — per-agent allowlist in agent_collections (existing behavior, default).
--   "USER"        — agent inherits whatever the CALLING USER can see in spaces;
--                   the allowlist is ignored at runtime. See routes/mcp.ts and
--                   mcp/kb-handlers.ts.
ALTER TABLE "agents"
  ADD COLUMN "kbScope" TEXT NOT NULL DEFAULT 'COLLECTIONS';
