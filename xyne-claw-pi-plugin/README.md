# xyne-claw

A Pi extension (plugin) for the [`xyne`](https://github.com/xynehq/xyne-cli) CLI that adds **Xyne Claw** remote-agent support — **without any change to the CLI core**.

## What it adds

**Tools** (the agent can call these in a conversation):
- `claw_list_agents` — list Claw agents you can invoke
- `claw_list_sessions` — list your recent Claw sessions/runs
- `claw_run_agent` — dispatch a task to a remote agent and wait for the result

**Slash command** (you type these):
```
/claw login              # opens the browser to authorize this device
/claw logout
/claw whoami
/claw agents
/claw sessions
/claw run <slug> <task>  # or just /claw run and pick interactively
```

## Install

```bash
# local checkout
xyne extension add /path/to/xyne-claw-plugin

# or from git / npm once published
xyne extension add git:github.com/xynehq/xyne-claw-plugin
xyne extension add npm:xyne-claw
```

Then start `xyne` and run `/claw login`.

## How it works

- **Login** is a device/pairing-code flow: the plugin calls `POST /claw/api/v1/cli/auth/start`, opens your browser to a Claw page already authenticated by your Spaces session, you click **Authorize**, and the plugin polls `POST /claw/api/v1/cli/auth/token` until a token is minted. The token is stored at `~/.xyne/agent/claw.json`.
- **Runs** are async: `POST /run` returns a `sessionId`; the plugin polls `GET /runs/:sessionId` until the run reaches a terminal status (`completed`/`failed`/`cancelled`).
- All authenticated calls send `Authorization: Bearer <token>`.

## Configuration

- `XYNE_CLAW_BASE_URL` — override the Claw origin (default `https://app.spaces.xyne.juspay.net`). Handy for local dev: `XYNE_CLAW_BASE_URL=http://localhost:3003`.
- `/claw login http://localhost:3003` — log in against a specific backend (also persisted).
- `XYNE_AGENT_DIR` — override where `claw.json` is stored (matches the CLI).

## Server requirements

This plugin expects the Claw backend to provide the CLI-login + user-scoped endpoints:
`POST /cli/auth/start`, `POST /cli/auth/token`, `GET /agents`, `GET /runs/light`,
`POST /run` (prompt in `task`), `GET /runs/:sessionId`. All Bearer-authed; the server
resolves identity from the token and must ignore any inbound `x-user-id`.
