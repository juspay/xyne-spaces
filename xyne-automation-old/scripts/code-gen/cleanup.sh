#!/bin/zsh

# Cleanup Script — Remove all generated backup, log, and debug files
# Keeps: spec files, .feature files, .steps.ts files
# Usage: npm run codegen-cleanup

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTOMATION_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

echo "=========================================="
echo "  Cleanup — Remove Generated Files"
echo "=========================================="
echo ""

# Debug: show paths
echo -e "${CYAN}Automation directory: $AUTOMATION_DIR${NC}"
echo ""

# Detect dashboard
DASHBOARD_DIR=""
if [ -d "$AUTOMATION_DIR/../../dashboard/src" ]; then
    DASHBOARD_DIR="$(cd "$AUTOMATION_DIR/../../dashboard/src" && pwd)"
elif [ -d "$AUTOMATION_DIR/../dashboard/src" ]; then
    DASHBOARD_DIR="$(cd "$AUTOMATION_DIR/../dashboard/src" && pwd)"
fi

FILES_TO_DELETE=()
DIRS_TO_DELETE=()

# Allow globs to expand to nothing without error (zsh)
setopt nullglob 2>/dev/null || true
setopt nonomatch 2>/dev/null || true

# 1. Original spec backups (use find to avoid glob errors)
while IFS= read -r f; do
    [ -f "$f" ] && FILES_TO_DELETE+=("$f")
done <<< "$(find "$AUTOMATION_DIR/tests" -type f \( -name "*_original.spec.ts" -o -name "*.spec.ts_original" \) 2>/dev/null)"

# 2. All llm_reports directory and its contents
if [ -d "$AUTOMATION_DIR/llm_reports" ]; then
    while IFS= read -r f; do
        [ -f "$f" ] && FILES_TO_DELETE+=("$f")
    done <<< "$(find "$AUTOMATION_DIR/llm_reports" -type f 2>/dev/null)"
    DIRS_TO_DELETE+=("$AUTOMATION_DIR/llm_reports")
fi

# 3. All _previous dirs in 03_e2e and their contents
while IFS= read -r d; do
    if [ -d "$d" ]; then
        while IFS= read -r f; do
            [ -f "$f" ] && FILES_TO_DELETE+=("$f")
        done <<< "$(find "$d" -type f 2>/dev/null)"
        DIRS_TO_DELETE+=("$d")
    fi
done <<< "$(find "$AUTOMATION_DIR/tests/03_e2e" -type d -name "_previous" 2>/dev/null)"

# 4. Dashboard .backup files and _original files
if [ -n "$DASHBOARD_DIR" ]; then
    while IFS= read -r f; do
        [ -f "$f" ] && FILES_TO_DELETE+=("$f")
    done <<< "$(find "$DASHBOARD_DIR" -type f \( -name "*.backup" -o -name "*_original" -o -name "*_original.*" \) 2>/dev/null)"
fi

TOTAL_FILES=${#FILES_TO_DELETE[@]}

if [ "$TOTAL_FILES" -eq 0 ]; then
    echo -e "${GREEN}✓ Nothing to clean up. All clean!${NC}"
    exit 0
fi

# Display files
echo -e "${CYAN}Files to be deleted:${NC}"
echo ""

echo -e "${YELLOW}── Spec Backups ──${NC}"
FOUND=0
for f in "${FILES_TO_DELETE[@]}"; do
    if [[ "$f" == *"_original.spec.ts" ]] || [[ "$f" == *".spec.ts_original" ]]; then
        echo -e "  ${RED}✗${NC} $(echo "$f" | sed "s|$AUTOMATION_DIR/||")"
        FOUND=$((FOUND + 1))
    fi
done
[ "$FOUND" -eq 0 ] && echo -e "  ${GREEN}(none)${NC}"
echo ""

echo -e "${YELLOW}── LLM Debug Output ──${NC}"
FOUND=0
for f in "${FILES_TO_DELETE[@]}"; do
    if [[ "$f" == *"llm_output_debug"* ]]; then
        echo -e "  ${RED}✗${NC} $(echo "$f" | sed "s|$AUTOMATION_DIR/||")"
        FOUND=$((FOUND + 1))
    fi
done
[ "$FOUND" -eq 0 ] && echo -e "  ${GREEN}(none)${NC}"
echo ""

echo -e "${YELLOW}── TestID Debug Output ──${NC}"
FOUND=0
for f in "${FILES_TO_DELETE[@]}"; do
    if [[ "$f" == *"testid_debug"* ]]; then
        echo -e "  ${RED}✗${NC} $(echo "$f" | sed "s|$AUTOMATION_DIR/||")"
        FOUND=$((FOUND + 1))
    fi
done
[ "$FOUND" -eq 0 ] && echo -e "  ${GREEN}(none)${NC}"
echo ""

echo -e "${YELLOW}── Conversion Logs ──${NC}"
FOUND=0
for f in "${FILES_TO_DELETE[@]}"; do
    if [[ "$f" == *"conversion_logs"* ]]; then
        echo -e "  ${RED}✗${NC} $(echo "$f" | sed "s|$AUTOMATION_DIR/||")"
        FOUND=$((FOUND + 1))
    fi
done
[ "$FOUND" -eq 0 ] && echo -e "  ${GREEN}(none)${NC}"
echo ""

echo -e "${YELLOW}── Dry Run Reports ──${NC}"
FOUND=0
for f in "${FILES_TO_DELETE[@]}"; do
    if [[ "$f" == *"dry_run"* ]]; then
        echo -e "  ${RED}✗${NC} $(echo "$f" | sed "s|$AUTOMATION_DIR/||")"
        FOUND=$((FOUND + 1))
    fi
done
[ "$FOUND" -eq 0 ] && echo -e "  ${GREEN}(none)${NC}"
echo ""

echo -e "${YELLOW}── Failed Attempt Backups ──${NC}"
FOUND=0
for f in "${FILES_TO_DELETE[@]}"; do
    if [[ "$f" == *"_previous"* ]]; then
        echo -e "  ${RED}✗${NC} $(echo "$f" | sed "s|$AUTOMATION_DIR/||")"
        FOUND=$((FOUND + 1))
    fi
done
[ "$FOUND" -eq 0 ] && echo -e "  ${GREEN}(none)${NC}"
echo ""

echo -e "${YELLOW}── Dashboard .backup / _original Files ──${NC}"
FOUND=0
for f in "${FILES_TO_DELETE[@]}"; do
    if [[ "$f" == *".backup" ]] || ( [[ "$f" == *"_original"* ]] && [[ "$f" != *"_original.spec.ts" ]] && [[ "$f" != *".spec.ts_original" ]] ); then
        REL=$(echo "$f" | sed "s|$AUTOMATION_DIR/||")
        [ "$REL" = "$f" ] && REL=$(echo "$f" | sed "s|$(dirname "$AUTOMATION_DIR")/||")
        echo -e "  ${RED}✗${NC} $REL"
        FOUND=$((FOUND + 1))
    fi
done
[ "$FOUND" -eq 0 ] && echo -e "  ${GREEN}(none)${NC}"
echo ""

echo "=========================================="
echo -e "${CYAN}Total: $TOTAL_FILES file(s) to remove${NC}"
echo "=========================================="
echo ""

echo -e "${GREEN}Will NOT delete:${NC}"
echo -e "  ${GREEN}✓${NC} Playwright spec files"
echo -e "  ${GREEN}✓${NC} Generated .feature files"
echo -e "  ${GREEN}✓${NC} Generated .steps.ts files"
echo -e "  ${GREEN}✓${NC} Shared step definitions"
echo ""

echo -e "${RED}Delete these files? (y/n)${NC}"
read -r CONFIRM < /dev/tty

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo -e "${YELLOW}Aborted. No files deleted.${NC}"
    exit 0
fi

# Delete files
DELETED=0
for f in "${FILES_TO_DELETE[@]}"; do
    if [ -f "$f" ]; then
        rm -f "$f"
        DELETED=$((DELETED + 1))
    fi
done

# Delete directories
for d in "${DIRS_TO_DELETE[@]}"; do
    [ -d "$d" ] && rm -rf "$d"
done

echo ""
echo -e "${GREEN}✓ Deleted $DELETED file(s). Cleanup complete!${NC}"
exit 0