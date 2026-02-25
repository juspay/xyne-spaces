#!/bin/bash

# Setup script - Make all scripts executable
# Run this once after cloning the repo

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==========================================
  Xyne Automation - Setup
=========================================="
echo ""

# Check Node.js version
echo "Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)

if [ "$NODE_MAJOR" -ne 20 ] && [ "$NODE_MAJOR" -ne 22 ] && [ "$NODE_MAJOR" -lt 24 ]; then
    echo "❌ Current Node.js version v$NODE_VERSION is not supported"
    echo "   Cucumber requires Node.js version 20 || 22 || >=24"
    echo ""
    
    # Check if nvm is available
    if command -v nvm &> /dev/null || [ -s "$HOME/.nvm/nvm.sh" ]; then
        echo "Installing Node.js 22 using nvm..."
        
        # Load nvm if not already loaded
        if ! command -v nvm &> /dev/null; then
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        fi
        
        nvm install 22
        nvm use 22
        
        # Verify installation
        NODE_VERSION=$(node -v | cut -d'v' -f2)
        echo "✓ Node.js v$NODE_VERSION installed and activated"
    else
        echo "nvm is not installed. Please install Node.js manually:"
        echo "  - Install nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
        echo "  - Then run: nvm install 22 && nvm use 22"
        echo "  - Or using brew: brew install node@22"
        exit 1
    fi
else
    echo "✓ Node.js version v$NODE_VERSION is supported"
fi

echo ""

echo "Making scripts executable..."

chmod +x "$SCRIPT_DIR/test-automate.sh"
chmod +x "$SCRIPT_DIR/test-and-run.sh"
chmod +x "$SCRIPT_DIR/add-testid-llm.sh"
chmod +x "$SCRIPT_DIR/cleanup.sh"

echo "✓ All scripts are now executable"
echo ""

# If Node.js was just installed, remind user to activate it
if [ "$NODE_MAJOR" -ne 20 ] && [ "$NODE_MAJOR" -ne 22 ] && [ "$NODE_MAJOR" -lt 24 ]; then
    echo "⚠️  IMPORTANT: Node.js 22 was installed but you need to activate it in your current shell:"
    echo "   Run: nvm use 22"
    echo ""
fi

echo "You can now run:"
echo "  npm run codegen-and-test -- <spec-file.spec.ts>"
echo "  npm run codegen -- <spec-file.spec.ts>"
echo "  npm run codegen-cleanup"
echo ""

# Export environment variables for Claude Code
export JUSPAY_API_KEY=your-llm-key

export GEMINI_API_KEY=""
export GOOGLE_CLOUD_PROJECT=""
export GOOGLE_APPLICATION_CREDENTIALS=""
export CLAUDE_CODE_USE_VERTEX=""
export CLOUD_ML_REGION=""
export GOOGLE_VERTEX_PROJECT=""
export ANTHROPIC_VERTEX_PROJECT_ID=""

export ANTHROPIC_BASE_URL="https://grid.ai.example.com/"
export ANTHROPIC_AUTH_TOKEN="$JUSPAY_API_KEY"
export ANTHROPIC_MODEL="kimi-latest"

export DISABLE_INTERLEAVED_THINKING=true
export API_TIMEOUT_MS=600000
export BASH_MAX_TIMEOUT_MS=300000
export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1

echo "✓ Environment variables exported"
echo "  Note: Update JUSPAY_API_KEY with your actual API key before running"