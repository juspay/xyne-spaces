# Xyne Doctor

Xyne Doctor is the repository's local failure-to-fix loop. It is a dependency-free Node script,
not a published package, service, or telemetry client.

When a guarded command exits unsuccessfully, it keeps the real output in the terminal, extracts a
small likely-signal block, masks credential-shaped values, and offers to open Claude Code or Codex
in the same repository with a bounded repair brief. The agent inherits your normal permission and
sandbox settings.

## Guarded commands

These root commands use Xyne Doctor automatically:

```bash
pnpm run up
pnpm run bootstrap
pnpm run services
pnpm run dev
pnpm run dev:all
pnpm run validate
```

`pnpm run validate` runs the primary dashboard's existing validation chain. It is not a substitute
for every job in `.github/workflows/ci.yml`.

The dashboard's own command is guarded too:

```bash
cd apps/dashboard
pnpm run validate
```

Guard any other command without adding another package script:

```bash
pnpm run doctor \
  --label backend:typecheck -- \
  pnpm --filter xyne-spaces-backend run typecheck
```

The built-in aliases are also available directly:

```bash
pnpm run doctor services
pnpm run doctor dev
pnpm run doctor validate
```

Forward Doctor options through an already guarded package shortcut after `--`:

```bash
pnpm run services -- --plain
pnpm run validate -- --no-motion
```

Preview the failure experience with safe fixture output:

```bash
pnpm run doctor:demo
```

## What happens after a failure

In a human terminal, Xyne Doctor offers the installed options:

1. Open Claude Code or Codex with the safe repair brief.
2. Preview or copy that brief.
3. Rerun the exact command.
4. Exit with the original failure code.

After an agent session closes, the command is still considered failed. Only a successful rerun
changes the final exit code to zero.

For interactive failures (and an explicit non-interactive `--agent copy` action), the repair brief
and sanitized output tail are written with private file permissions under:

```text
.xyne/doctor/runs/<timestamp-pid-random>/
```

That directory is gitignored. Plain, CI, hook, and ordinary redirected failures do not persist a
report. The script makes no network request itself; choosing an agent starts the already-installed
local CLI.

## Safety and automation behavior

- Ctrl-C and termination signals are forwarded to the child and never trigger a handoff.
- CI, Git hooks, redirected output, and `TERM=dumb` use stable plain text and never launch an agent.
- `--plain` or `--no-interactive` forces the same non-interactive behavior.
- `XYNE_DOCTOR_NO_INTERACTIVE=1` does the same for repository hooks and automation.
- `--no-motion` or `XYNE_DOCTOR_NO_MOTION=1` keeps the menu but removes timed animation.
- `XYNE_DOCTOR_ASCII=1` replaces Unicode terminal symbols with ASCII.
- The child is spawned with an argument array and `shell: false`; shell metacharacters stay literal.
- Captured context is bounded. Oversized logs retain their tail and state that truncation occurred.
- Redaction covers common credential formats and secret-bearing assignments, but no pattern matcher
  can recognize every opaque secret. Preview the brief before sharing logs with unusual credentials.
- Agent handoff uses ordinary Claude Code/Codex permissions. No approval-bypass flag is added.

The wrapper reacts to process exit status. A watch-mode process can print a compile or runtime error
and remain alive; that is not treated as a completed command failure. Supporting live watch-process
diagnostics would require structured events or narrowly defined health checks rather than guessing
from red terminal text.

## Terminal compatibility

The child keeps the terminal's stdin, while stdout and stderr are mirrored through the wrapper so a
safe tail can be retained. The service feature picker therefore remains interactive. A nested tool
that requires its own stdout to be a TTY may choose a plain rendering mode; fully transparent nested
TUIs would require a cross-platform pseudo-terminal dependency.

On Windows, guarded presets run through the platform command host. Agent CLIs installed only as
`.cmd` shims use the copy-prompt fallback; native agent executables can still be opened directly.
Custom commands should target a directly executable file rather than an arbitrary `.cmd` shim.
