#!/bin/bash

# ==========================================================
#  Xyne Automation - TestID Conversion Setup
#  One-command setup: npm run setup (from xyne-automation/)
# ==========================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SHELL_RC=""
CHANGES_MADE=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

print_header() {
    echo ""
    echo -e "${CYAN}===========================================${NC}"
    echo -e "${BOLD}  Xyne Automation - TestID Setup${NC}"
    echo -e "${CYAN}===========================================${NC}"
    echo ""
}

print_step() {
    echo -e "${BLUE}▶ STEP $1:${NC} ${BOLD}$2${NC}"
}

print_success() {
    echo -e "  ${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "  ${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "  ${RED}✗${NC} $1"
}

print_info() {
    echo -e "  ${CYAN}ℹ${NC} $1"
}

# ============================
# Detect shell config file
# ============================
detect_shell_rc() {
    if [ -n "$ZSH_VERSION" ] || [ "$SHELL" = "/bin/zsh" ]; then
        SHELL_RC="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ] || [ "$SHELL" = "/bin/bash" ]; then
        SHELL_RC="$HOME/.bashrc"
    else
        SHELL_RC="$HOME/.profile"
    fi
    print_info "Detected shell config: ${BOLD}$SHELL_RC${NC}"
}

# ============================
# Add env var to shell RC file (idempotent)
# ============================
add_to_shell_rc() {
    local var_name="$1"
    local var_value="$2"
    local export_line="export ${var_name}=\"${var_value}\""

    if grep -q "^export ${var_name}=" "$SHELL_RC" 2>/dev/null; then
        # Update existing value
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|^export ${var_name}=.*|${export_line}|" "$SHELL_RC"
        else
            sed -i "s|^export ${var_name}=.*|${export_line}|" "$SHELL_RC"
        fi
        print_info "Updated ${var_name} in $SHELL_RC"
    else
        # Add section header if first time
        if ! grep -q "# Xyne Automation - Claude Config" "$SHELL_RC" 2>/dev/null; then
            echo "" >> "$SHELL_RC"
            echo "# ============================================" >> "$SHELL_RC"
            echo "# Xyne Automation - Claude Config" >> "$SHELL_RC"
            echo "# ============================================" >> "$SHELL_RC"
        fi
        echo "$export_line" >> "$SHELL_RC"
        print_info "Added ${var_name} to $SHELL_RC"
    fi
    CHANGES_MADE=true

    # Also export in current session
    export "${var_name}=${var_value}"
}

# ============================
# Prompt for API key
# ============================
prompt_api_key() {
    local current_key=""

    # Check if already set in shell RC
    if grep -q "^export JUSPAY_API_KEY=" "$SHELL_RC" 2>/dev/null; then
        current_key=$(grep "^export JUSPAY_API_KEY=" "$SHELL_RC" | sed 's/export JUSPAY_API_KEY="//' | sed 's/"$//')
    fi

    # Check if set in environment
    if [ -n "$JUSPAY_API_KEY" ] && [ "$JUSPAY_API_KEY" != "your-llm-key" ]; then
        current_key="$JUSPAY_API_KEY"
    fi

    # All interactive output goes to stderr so stdout only has the key value
    if [ -n "$current_key" ] && [ "$current_key" != "your-llm-key" ]; then
        local masked_key="${current_key:0:8}...${current_key: -4}"
        echo -e "  ${CYAN}ℹ${NC} Existing API key found: ${masked_key}" >&2
        echo "" >&2
        read -p "  Keep existing key? (Y/n): " keep_key </dev/tty
        if [ "$keep_key" = "n" ] || [ "$keep_key" = "N" ]; then
            current_key=""
        fi
    fi

    if [ -z "$current_key" ] || [ "$current_key" = "your-llm-key" ]; then
        echo "" >&2
        echo -e "  ${YELLOW}You need a Juspay Grid API key to use Claude.${NC}" >&2
        echo -e "  ${CYAN}Get your key from: https://grid.ai.example.com${NC}" >&2
        echo "" >&2
        read -p "  Enter your JUSPAY_API_KEY: " current_key </dev/tty

        if [ -z "$current_key" ]; then
            echo -e "  ${RED}✗${NC} API key is required. You can set it later:" >&2
            echo -e "  ${CYAN}ℹ${NC}   export JUSPAY_API_KEY=\"your-key-here\"" >&2
            echo -e "  ${CYAN}ℹ${NC}   Then re-run: npm run setup" >&2
            exit 1
        fi
    fi

    # Only the key value goes to stdout (captured by caller)
    echo "$current_key"
}

# ============================
# STEP 1: Check Node.js
# ============================
check_node() {
    print_step "1" "Checking Node.js version"

    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        print_info "Install via nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
        print_info "Then run: nvm install 22 && nvm use 22"
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d'v' -f2)
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)

    if [ "$NODE_MAJOR" -ne 20 ] && [ "$NODE_MAJOR" -ne 22 ] && [ "$NODE_MAJOR" -lt 24 ]; then
        print_warning "Node.js v${NODE_VERSION} — requires 20, 22, or >=24"

        if command -v nvm &> /dev/null || [ -s "$HOME/.nvm/nvm.sh" ]; then
            print_info "Installing Node.js 22 via nvm..."

            if ! command -v nvm &> /dev/null; then
                export NVM_DIR="$HOME/.nvm"
                [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
            fi

            nvm install 22
            nvm use 22
            NODE_VERSION=$(node -v | cut -d'v' -f2)
            print_success "Node.js v${NODE_VERSION} installed and active"
        else
            print_error "nvm not found. Install Node.js 22 manually:"
            print_info "  brew install node@22"
            print_info "  OR install nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
            exit 1
        fi
    else
        print_success "Node.js v${NODE_VERSION}"
    fi
}

# ============================
# STEP 2: Install npm dependencies
# ============================
install_deps() {
    print_step "2" "Installing npm dependencies"

    cd "$AUTOMATION_DIR"

    if [ -f "package-lock.json" ] && [ -d "node_modules" ]; then
        print_info "node_modules exists, running npm ci..."
        npm ci --silent 2>/dev/null || npm install --silent
    else
        print_info "Running npm install..."
        npm install --silent
    fi

    print_success "npm dependencies installed"
}

# ============================
# STEP 3: Install Playwright
# ============================
install_playwright() {
    print_step "3" "Installing Playwright"

    cd "$AUTOMATION_DIR"

    # Check if playwright is already in node_modules
    if [ -d "node_modules/@playwright" ]; then
        print_success "Playwright package already installed"
    else
        print_info "Installing Playwright..."
        npm install playwright --save-dev --silent
    fi

    # Install browsers
    print_info "Installing Playwright browsers (this may take a few minutes)..."
    npx playwright install --with-deps chromium 2>/dev/null || npx playwright install chromium
    print_success "Playwright browsers installed"

    # Check for playwright config
    if [ -f "$AUTOMATION_DIR/playwright.config.ts" ] || [ -f "$AUTOMATION_DIR/playwright.config.js" ]; then
        print_success "Playwright config found"
        print_info "VS Code: Add ${BOLD}xyne-automation/playwright.config${NC} in Playwright extension settings"
    else
        print_warning "No playwright.config found in xyne-automation/"
        print_info "Create one or check if it's in a subdirectory"
    fi
}

# ============================
# STEP 4: Install Claude CLI
# ============================
install_claude() {
    print_step "4" "Setting up Claude CLI"

    if command -v claude &> /dev/null; then
        CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "installed")
        print_success "Claude CLI already installed (${CLAUDE_VERSION})"
    else
        print_info "Installing Claude CLI..."
        curl -fsSL https://claude.ai/install.sh | bash

        # Reload PATH
        export PATH="$HOME/.claude/bin:$HOME/.local/bin:$PATH"

        if command -v claude &> /dev/null; then
            print_success "Claude CLI installed successfully"
        else
            print_error "Claude CLI installation failed"
            print_info "Try manually: curl -fsSL https://claude.ai/install.sh | bash"
            print_info "Then restart your terminal and re-run setup"
            exit 1
        fi
    fi
}

# ============================
# STEP 5: Configure environment variables (persisted to ~/.zshrc)
# ============================
configure_env() {
    print_step "5" "Configuring environment variables (persistent)"

    detect_shell_rc

    # Backup shell RC
    if [ -f "$SHELL_RC" ]; then
        cp "$SHELL_RC" "${SHELL_RC}.backup.$(date +%Y%m%d%H%M%S)"
        print_info "Backup created: ${SHELL_RC}.backup.*"
    fi

    # Get API key
    API_KEY=$(prompt_api_key)
    echo ""

    print_info "Writing environment variables to ${SHELL_RC}..."
    echo ""

    # Core API key
    add_to_shell_rc "JUSPAY_API_KEY" "$API_KEY"

    # Claude / Anthropic config — routed through Juspay Grid
    add_to_shell_rc "ANTHROPIC_BASE_URL" "https://grid.ai.example.com"
    add_to_shell_rc "ANTHROPIC_AUTH_TOKEN" "\$JUSPAY_API_KEY"
    add_to_shell_rc "ANTHROPIC_MODEL" "kimi-latest"
    add_to_shell_rc "ANTHROPIC_SMALL_FAST_MODEL" "open-fast"
    add_to_shell_rc "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS" "1"

    # Disable Google Vertex (not needed — avoids credential errors)
    add_to_shell_rc "CLAUDE_CODE_USE_VERTEX" ""
    add_to_shell_rc "GOOGLE_APPLICATION_CREDENTIALS" ""
    add_to_shell_rc "GOOGLE_CLOUD_PROJECT" ""
    add_to_shell_rc "GOOGLE_VERTEX_PROJECT" ""
    add_to_shell_rc "ANTHROPIC_VERTEX_PROJECT_ID" ""
    add_to_shell_rc "CLOUD_ML_REGION" ""
    add_to_shell_rc "GEMINI_API_KEY" ""

    # Timeouts
    add_to_shell_rc "DISABLE_INTERLEAVED_THINKING" "true"
    add_to_shell_rc "API_TIMEOUT_MS" "600000"
    add_to_shell_rc "BASH_MAX_TIMEOUT_MS" "300000"

    echo ""
    print_success "Environment variables configured and persisted to ${SHELL_RC}"
    print_info "These will be available in ALL new terminals — no need to re-export!"
}

# ============================
# STEP 6: Make scripts executable
# ============================
make_executable() {
    print_step "6" "Making scripts executable"

    local scripts=(
        "$SCRIPT_DIR/test-automate.sh"
        "$SCRIPT_DIR/test-and-run.sh"
        "$SCRIPT_DIR/add-testid-llm.sh"
        "$SCRIPT_DIR/cleanup.sh"
    )

    for script in "${scripts[@]}"; do
        if [ -f "$script" ]; then
            chmod +x "$script"
            print_success "$(basename "$script")"
        else
            print_warning "$(basename "$script") — not found, skipping"
        fi
    done
}

# ============================
# STEP 7: Verify setup
# ============================
verify_setup() {
    print_step "7" "Verifying setup"

    local all_good=true

    # Node
    if command -v node &> /dev/null; then
        print_success "Node.js $(node -v)"
    else
        print_error "Node.js not found"
        all_good=false
    fi

    # npm
    if command -v npm &> /dev/null; then
        print_success "npm $(npm -v)"
    else
        print_error "npm not found"
        all_good=false
    fi

    # Playwright
    if [ -d "$AUTOMATION_DIR/node_modules/@playwright" ]; then
        print_success "Playwright installed"
    else
        print_error "Playwright not found"
        all_good=false
    fi

    # Claude
    if command -v claude &> /dev/null; then
        print_success "Claude CLI available"
    else
        print_warning "Claude CLI not in PATH (may need terminal restart)"
    fi

    # API key
    if [ -n "$JUSPAY_API_KEY" ] && [ "$JUSPAY_API_KEY" != "your-llm-key" ]; then
        local masked="${JUSPAY_API_KEY:0:8}..."
        print_success "API key configured (${masked})"
    else
        print_error "API key not set"
        all_good=false
    fi

    # Shell RC
    if grep -q "ANTHROPIC_BASE_URL" "$SHELL_RC" 2>/dev/null; then
        print_success "Environment persisted in ${SHELL_RC}"
    else
        print_warning "Environment not persisted"
    fi

    echo ""
    if [ "$all_good" = true ]; then
        echo -e "${GREEN}${BOLD}  ✅ Setup complete!${NC}"
    else
        echo -e "${YELLOW}${BOLD}  ⚠️  Setup completed with warnings${NC}"
    fi
}

# ============================
# Print next steps
# ============================
print_next_steps() {
    echo ""
    echo -e "${CYAN}===========================================${NC}"
    echo -e "${BOLD}  Next Steps${NC}"
    echo -e "${CYAN}===========================================${NC}"
    echo ""

    if [ "$CHANGES_MADE" = true ]; then
        echo -e "  ${YELLOW}1. Reload your shell config:${NC}"
        echo -e "     ${BOLD}source ${SHELL_RC}${NC}"
        echo ""
        echo -e "  ${YELLOW}2. VS Code Playwright Extension:${NC}"
        echo "     • Install 'Playwright Test for VS Code' extension"
        echo "     • Open command palette (Cmd+Shift+P)"
        echo "     • Search 'Playwright: Select Config'"
        echo "     • Select: xyne-automation/playwright.config"
        echo ""
        echo -e "  ${YELLOW}3. Run TestID conversion:${NC}"
        echo "     cd xyne-automation"
        echo -e "     ${BOLD}npm run codegen -- <spec-file.spec.ts>${NC}"
        echo ""
        echo -e "  ${YELLOW}4. Run codegen + test:${NC}"
        echo -e "     ${BOLD}npm run codegen-and-test -- <spec-file.spec.ts>${NC}"
        echo ""
        echo -e "  ${YELLOW}5. Cleanup generated files:${NC}"
        echo -e "     ${BOLD}npm run codegen-cleanup${NC}"
    else
        echo "  All configured! Run:"
        echo -e "     ${BOLD}npm run codegen -- <spec-file.spec.ts>${NC}"
    fi

    echo ""
    echo -e "${CYAN}===========================================${NC}"
    echo ""
}

# ============================
# Main
# ============================
main() {
    print_header
    check_node
    echo ""
    install_deps
    echo ""
    install_playwright
    echo ""
    install_claude
    echo ""
    configure_env
    echo ""
    make_executable
    echo ""
    verify_setup
    print_next_steps
}

main "$@"