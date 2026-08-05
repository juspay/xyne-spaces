# Local Setup — from a blank machine

Everything between "new laptop" and a running Xyne Spaces environment. This page
assumes **nothing** is installed — not Git, not Node, not Docker. If your tooling is
already in place, skip to [Prerequisites](prerequisites.md) for the version check and
[Local Development](local-development.md) for the day-to-day commands.

What you will end up with:

- Node 22 + pnpm 10.15.0 (the exact versions CI uses)
- A container runtime with the infrastructure stack (Postgres, Redis, MinIO, …)
- The repo cloned, configured, and running at **http://localhost:5173**

Expect 30–60 minutes on a fresh machine, most of it downloads.

---

## macOS

### 1. Command Line Tools and Homebrew

```bash
xcode-select --install        # compilers Git and native modules need
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the "Next steps" Homebrew prints — on Apple Silicon it asks you to add
`eval "$(/opt/homebrew/bin/brew shellenv)"` to `~/.zprofile`. Open a new terminal
afterwards so `brew` is on your PATH.

### 2. Git and Node 22

```bash
brew install git node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
exec zsh
node --version                # v22.x
```

### 3. pnpm via Corepack

Corepack ships with Node and reads the version pinned in this repo, so you never
manage pnpm by hand:

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm --version                # 10.15.0
```

### 4. Container runtime

Install **one** of these and *launch it* (installed is not the same as running):

```bash
brew install orbstack         # lighter, faster on macOS — recommended
# or
brew install --cask docker    # Docker Desktop
```

Open OrbStack or Docker Desktop once so the daemon starts, and give it at least
**8 GB memory / 20 GB disk** in its settings. The stack runs Postgres, Redis,
LiveKit, MinIO, Y-Sweet, Zero, and more at the same time.

Continue at [Clone and run](#clone-and-run).

---

## Linux (Debian / Ubuntu)

### 1. Build tools and native-module dependencies

```bash
sudo apt-get update
sudo apt-get install -y git curl build-essential python3 make g++ \
                        libcairo2-dev libpango1.0-dev libjpeg-dev \
                        libgif-dev librsvg2-dev libssl-dev
```

The `lib*` packages are needed by the `canvas` native module — installing them now
avoids a cryptic `pnpm install` failure later.

### 2. Node 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version                # v22.x
```

(Any installer works — `fnm` and `nvm` are fine too — as long as you end up on 22.x.)

### 3. pnpm via Corepack

```bash
sudo corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm --version                # 10.15.0
```

If Corepack cannot write to the system Node prefix, install to your user instead:

```bash
npm install -g --prefix "$HOME/.local" pnpm@10.15.0
export PATH="$HOME/.local/bin:$PATH"
```

### 4. Docker Engine + Compose

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker                 # or log out and back in
docker compose version        # Compose v2.x
```

Continue at [Clone and run](#clone-and-run).

---

## Windows (WSL2)

Native Windows is possible (`pnpm run services:win`) but far less exercised. The
supported path is WSL2 — a real Linux environment inside Windows.

### 1. Install WSL2 + Ubuntu

In **PowerShell as Administrator**:

```powershell
wsl --install -d Ubuntu
```

Reboot when asked, then open the "Ubuntu" app and create your Linux user.

### 2. Docker Desktop with the WSL2 backend

Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/),
then in *Settings → Resources → WSL integration* enable your Ubuntu distro. Give it
at least **8 GB memory** under *Resources*. `docker` now works inside Ubuntu.

### 3. Follow the Linux steps

Inside the Ubuntu terminal, do the [Linux section](#linux-debian--ubuntu) — skip its
Docker step (Docker Desktop already provides it). One important rule: **keep the
repo inside the Linux filesystem** (e.g. `~/code/xyne-spaces`), never under
`/mnt/c/...` — file watching and installs are an order of magnitude slower on the
Windows mount.

---

## Clone and run

```bash
git clone https://github.com/juspay/xyne-spaces.git
cd xyne-spaces
pnpm install
pnpm run up
```

> Using SSH keys with GitHub? `git clone git@github.com:juspay/xyne-spaces.git`
> works the same. If this is a brand-new machine, the HTTPS URL needs no setup.

`pnpm run up` is interactive. Here is the whole ride, in order:

### Stage 1 — supervised bootstrap (plain output)

Xyne Doctor (the repo's command supervisor — `pnpm run doctor`) runs the setup
chain and offers an AI handoff if a step fails: env files are copied, the workspace installs, shared libraries build,
and local secrets are generated. You will be asked:

1. **AI features** — paste an OpenAI-compatible endpoint now, or press Enter to
   skip (everything except AI works without it; see [AI Providers](ai-providers.md)).
2. **Which infrastructure features do you need?** — a checkbox picker. *Chat &
   Tickets* (Postgres, Redis, Zero, MinIO) is always on; toggle Calls, Canvas,
   Search, and the rest only if you need them. Choose **Everything**, **Core**, or
   pick individually. Fewer features = fewer containers = faster start.
3. **Local login** — a default admin (`admin@xyne.ai` / `xynelocal@123`) is always
   created; optionally add a login of your own.

If a port a container needs is already taken (a local Postgres on 5433, another
checkout's Redis on 6379), the setup tells you **which process holds which port**
before starting anything, and how to move the container with the `*_BIND_PORT`
variables.

First run takes a few minutes while container images download.

### Stage 2 — pick your apps

```
◆ Which apps do you want to run?
│ ● Same as last time   backend, worker, dashboard
│ ○ Everything          backend, worker, dashboard, claw, auth, auth-ui
│ ○ Core                backend, worker, dashboard
│ ○ Pick apps           choose exactly what runs
```

Your infrastructure choices set the defaults — selecting the Xyne-Claw feature
preselects the claw apps here. The selection is remembered for next time
(`.xyne/dev-apps.json`). Busy dev ports (3001, 5173, …) are detected here too, with
an offer to stop the stale process holding them.

### Stage 3 — the process TUI

The selected apps open in a multi-pane terminal UI ([mprocs](https://github.com/pvolok/mprocs)):
a process list on the left, and each process with its **own isolated pane** on the
right — no more six logs interleaved in one stream.

| Key | Action |
| --- | ------ |
| `↑` / `↓` | switch between processes |
| `r` | restart the selected process (e.g. just the backend) |
| `x` | stop it · `s` start it again |
| `z` | zoom the pane full-screen |
| `Ctrl-a` | focus the pane — keys go *into* that process; `Ctrl-a` again to leave |
| `q` | quit and stop everything |

## Verify it works

- Open **http://localhost:5173** and log in with `admin@xyne.ai` / `xynelocal@123`
  (or the login you created).
- Backend health: `curl http://localhost:3001/api/health`

## Stopping

- `q` in the TUI stops all dev processes.
- `pnpm run services:stop` stops the infrastructure containers.

## When something goes wrong

→ [Troubleshooting](troubleshooting.md) — includes the port-conflict, Docker-memory,
and native-module cases. For everything else about day-to-day work (running a single
app, database commands, what CI checks), see [Local Development](local-development.md).
