-- Per-subagent MCP instance pinning.
--
-- Companion to the agent-level multi-instance migration. A subagent that
-- belongs to an agent with N forked Grafana instances (e.g. "prod" and
-- "staging") can now restrict itself to a single instance. Example value:
--
--   {"grafana": "prod", "elasticsearch": "logs-cluster"}
--
-- At runtime the MCP runner reads this map: for each server type the
-- subagent's tool config selects, it spawns ONLY the parent agent's
-- AgentMcpConnection row whose slug matches. Unmapped server types fall
-- back to inherit-all (Stance A) — i.e. the subagent sees every instance
-- the parent has for that server.
--
-- NULL / empty map = inherit everything (today's behavior, no restriction).

ALTER TABLE "subagent_definitions"
    ADD COLUMN "mcpInstanceMap" JSONB;
