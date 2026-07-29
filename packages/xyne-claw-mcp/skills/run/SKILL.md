---
description: Run a Xyne Claw agent.
---

Parse `$ARGUMENTS` as:

```text
<agent-slug> <task...>
```

Use the first token as the agent slug. Use the remaining text as the task.

Call the `claw_run_agent` MCP tool with the parsed agent and task, then stream or print the returned result.

Optional delivery:
- `channel_id` — a Spaces channel/DM id → the agent posts its reply INTO that Spaces thread (not just the terminal). E.g. "run doctor-agent 'check PR #123' and post it to channel <id>".
- `deliver_to: "dm"` — post the reply to the user's own Spaces DM (requires a stored self-DM id from login; if absent, pass channel_id instead).
Default (neither) = result returns to the CLI only.
