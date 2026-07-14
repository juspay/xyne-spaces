---
description: Log the user into Xyne Claw.
---

Call the `claw_login` MCP tool.

Show the returned verification URL and user code, and tell the user to open the URL and approve the login with that code.

Poll `claw_whoami` until it reports that the user is logged in, then display the current Xyne Claw identity.
