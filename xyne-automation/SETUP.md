# Xyne Automation — TestID Conversion Setup Guide

## One-Command Setup

```bash
# From repo root
npm run setup
```

This single command does **everything** automatically:

| Step | What it does |
|------|-------------|
| 1 | Checks Node.js version (requires 20, 22, or >=24) — installs v22 via nvm if needed |
| 2 | Runs `npm install` for all xyne-automation dependencies |
| 3 | Installs Playwright + Chromium browser |
| 4 | Installs Claude CLI (`curl -fsSL https://claude.ai/install.sh \| bash`) |
| 5 | Prompts for your **JUSPAY_API_KEY** and writes all env vars to `~/.zshrc` permanently |
| 6 | Makes all helper scripts executable |
| 7 | Verifies everything is working |

---

## Prerequisites

- **macOS or Linux**
- **Git** (to clone the repo)
- **JUSPAY Grid API Key** — get it from [grid.ai.example.com](https://grid.ai.example.com)

---

## What Gets Configured

The setup script adds these to your `~/.zshrc` (persisted across all terminals):

```bash
# Xyne Automation - Claude Config
export JUSPAY_API_KEY="<your-key>"
export ANTHROPIC_BASE_URL="https://grid.ai.example.com"
export ANTHROPIC_AUTH_TOKEN="$JUSPAY_API_KEY"
export ANTHROPIC_MODEL="kimi-latest"
export ANTHROPIC_SMALL_FAST_MODEL="open-fast"
export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS="1"

# Google Vertex disabled (routed through Juspay Grid instead)
export CLAUDE_CODE_USE_VERTEX=""
export GOOGLE_APPLICATION_CREDENTIALS=""
export GOOGLE_CLOUD_PROJECT=""
export GOOGLE_VERTEX_PROJECT=""
export ANTHROPIC_VERTEX_PROJECT_ID=""
export CLOUD_ML_REGION=""
export GEMINI_API_KEY=""

# Timeouts
export DISABLE_INTERLEAVED_THINKING="true"
export API_TIMEOUT_MS="600000"
export BASH_MAX_TIMEOUT_MS="300000"
```

> **No more per-terminal exports!** The variables are written to `~/.zshrc` once and available in every new terminal.

---

## VS Code — Playwright Extension Setup

After running `npm run setup`, configure VS Code:

1. Install the **"Playwright Test for VS Code"** extension
2. Open Command Palette → `Cmd + Shift + P`
3. Search: **"Playwright: Select Config"**
4. Select: `xyne-automation/playwright.config`

---

## Usage

### Run TestID Conversion
```bash
cd xyne-automation
npm run codegen -- <spec-file.spec.ts>
```

### Run Codegen + Execute Tests
```bash
npm run codegen-and-test -- <spec-file.spec.ts>
```

### Cleanup Generated Files
```bash
npm run codegen-cleanup
```

---

## Troubleshooting

### "Claude CLI not found" after setup
```bash
source ~/.zshrc
# or restart your terminal
```

### "API key not working"
1. Verify your key at [grid.ai.example.com](https://grid.ai.example.com)
2. Check: `echo $JUSPAY_API_KEY`
3. Re-run: `npm run setup`

### "Node.js version not supported"
```bash
nvm install 22
nvm use 22
nvm alias default 22
```

### "Playwright browsers not installed"
```bash
npx playwright install chromium
```

### Google Vertex / Authentication errors in Jenkins
The error `Unexpected token '_', "_timestamp"... is not valid JSON` means `GOOGLE_APPLICATION_CREDENTIALS` points to an invalid file (likely an ADC token cache, not a service account JSON). The setup script clears all Vertex-related env vars since Claude routes through Juspay Grid instead.

### Re-run setup at any time
```bash
npm run setup
```
The script is **idempotent** — it won't duplicate entries or break existing config.

---

## Manual Setup (if you prefer)

```bash
# 1. Install Node.js 22
nvm install 22 && nvm use 22

# 2. Install dependencies
cd xyne-automation && npm install

# 3. Install Playwright
npm install playwright && npx playwright install chromium

# 4. Install Claude CLI
curl -fsSL https://claude.ai/install.sh | bash

# 5. Add to ~/.zshrc
cat >> ~/.zshrc << 'EOF'

# Xyne Automation - Claude Config
export JUSPAY_API_KEY="YOUR_KEY_HERE"
export ANTHROPIC_BASE_URL="https://grid.ai.example.com"
export ANTHROPIC_AUTH_TOKEN="$JUSPAY_API_KEY"
export ANTHROPIC_MODEL="kimi-latest"
export ANTHROPIC_SMALL_FAST_MODEL="open-fast"
export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS="1"
export CLAUDE_CODE_USE_VERTEX=""
export GOOGLE_APPLICATION_CREDENTIALS=""
export DISABLE_INTERLEAVED_THINKING="true"
export API_TIMEOUT_MS="600000"
export BASH_MAX_TIMEOUT_MS="300000"
EOF

# 6. Reload
source ~/.zshrc
```

---

## LLM Prompt (for automated setup)

Give this prompt to an LLM to set up the project:

> Set up the Xyne Automation TestID conversion environment. Run `npm run setup` from the repo root (`xyne-spaces/`). This will:
> 1. Check/install Node.js 22
> 2. Install npm dependencies
> 3. Install Playwright with Chromium
> 4. Install Claude CLI
> 5. Persist all required environment variables (JUSPAY_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL, etc.) to ~/.zshrc
> 6. Verify the setup
>
> After setup, configure VS Code Playwright extension to use `xyne-automation/playwright.config`.
> Then run: `cd xyne-automation && npm run codegen -- <spec-file.spec.ts>`
