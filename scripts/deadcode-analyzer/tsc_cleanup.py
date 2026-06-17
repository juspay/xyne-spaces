#!/usr/bin/env python3
"""
tsc error auto-cleanup. Fixes errors caused by dead-code removal:
  - TS2305: Barrel re-exports removed symbols
  - TS2307: Stale barrel points to deleted file
  - TS6133: Unused imports/variables in modified files
  - TS6196: Unused types/interfaces in modified files
  - TS6192: Entirely unused import declaration

Usage (called internally by knip_remover after removals):
    from tsc_cleanup import run_tsc_cleanup
    run_tsc_cleanup("dashboard/tsconfig.app.json", modified_files, dry_run)
"""

import os
import re
import subprocess
import sys
from pathlib import Path

MONOREPO_ROOT = Path(__file__).resolve().parent.parent.parent
TS_HELPER = MONOREPO_ROOT / "scripts" / "deadcode-analyzer" / "remove-declaration.cjs"


def run_tsc(tsconfig: str) -> list[dict]:
    """Run tsc --noEmit and return list of error dicts."""
    cmd = ["node", "node_modules/typescript/bin/tsc", "--noEmit", "--project", tsconfig]
    result = subprocess.run(cmd, cwd=MONOREPO_ROOT, capture_output=True, text=True)

    errors = []
    pattern = re.compile(r"^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$")

    for line in (result.stdout + result.stderr).splitlines():
        m = pattern.match(line.strip())
        if m:
            errors.append({
                "file": m.group(1),
                "line": int(m.group(2)),
                "col": int(m.group(3)),
                "code": m.group(4),
                "message": m.group(5),
            })

    return errors


def extract_exported_member(message: str) -> str | None:
    """Extract member name from TS2305/TS2724: Module 'X' has no exported member 'Y'."""
    m = re.search(r"has no exported member ['\"](\w+)['\"]", message)
    if m:
        return m.group(1)
    # TS2724 variant: "no exported member named 'Foo'. Did you mean 'Bar'?"
    m = re.search(r"no exported member named ['\"](\w+)['\"]", message)
    if m:
        return m.group(1)
    return None


def extract_missing_module(message: str) -> str | None:
    """Extract module path from TS2307: Cannot find module './Foo'."""
    m = re.search(r"Cannot find module ['\"](.+?)['\"]", message)
    if m:
        return m.group(1)
    return None


def extract_unused_name(message: str) -> str | None:
    """Extract name from TS6133/TS6196: 'Foo' is declared but never read."""
    m = re.search(r"['\"](\w+)['\"]\s+is declared but (its value is never read|never used)", message)
    if m:
        return m.group(1)
    return None


def remove_from_barrel(barrel_path: Path, member: str) -> bool:
    """Remove a named export member from a barrel index.ts file."""
    if not barrel_path.exists():
        return False

    content = barrel_path.read_text()
    original = content

    # Pattern 1: export { Foo, Bar } from './module'
    # Remove just the member name
    pattern1 = rf"(\{{[^{{}}]*?)\b{re.escape(member)}\b,?\s*([^{{}}]*\}})"
    content = re.sub(pattern1, lambda m: f"{m.group(1)}{m.group(2)}", content, count=1)

    # Clean up empty braces: export { } from './module' -> remove entire line
    content = re.sub(r"export\s*\{\s*\}\s*from\s+['\"][^'\"]+['\"];?\n?", "", content)

    # Pattern 2: export type { Foo } from './module'
    content = re.sub(rf"export\s+type\s*\{{\s*{re.escape(member)}\s*\}}\s*from\s+['\"][^'\"]+['\"];?\n?", "", content)

    # Pattern 3: export { Foo } (no from clause)
    content = re.sub(rf"export\s*\{{\s*{re.escape(member)}\s*\}}\s*;?\n?", "", content)

    # Pattern 4: export { default as Foo } from './module'
    content = re.sub(rf"export\s*\{{\s*default\s+as\s+{re.escape(member)}\s*\}}\s*from\s+['\"][^'\"]+['\"];?\n?", "", content)

    if content != original:
        barrel_path.write_text(content)
        print(f"    CLEANED barrel {barrel_path.relative_to(MONOREPO_ROOT)}: removed {member}")
        return True

    print(f"    ⚠ COULD NOT CLEAN barrel {barrel_path.relative_to(MONOREPO_ROOT)}: {member}")
    return False


def remove_unused_import(filepath: Path, symbol: str) -> bool:
    """Remove an unused import specifier or entire import statement."""
    if not filepath.exists():
        return False

    content = filepath.read_text()
    original = content

    # Pattern: import { ..., Foo, ... } from '...'
    # Remove just Foo from the braces
    pattern = rf"(\{{[^{{}}]*?)\b{re.escape(symbol)}\b,?\s*([^{{}}]*\}})"
    content = re.sub(pattern, lambda m: f"{m.group(1)}{m.group(2)}", content, count=1)

    # If braces are empty now: import { } from '...' -> remove whole line
    content = re.sub(r"import\s*\{\s*\}\s*from\s+['\"][^'\"]+['\"];?\n?", "", content)

    # Check for TS6192: "All imports in import declaration are unused"
    # The whole import { Foo, Bar } from 'baz' is dead
    # We handle this separately in the loop

    if content != original:
        filepath.write_text(content)
        print(f"    CLEANED import {filepath.relative_to(MONOREPO_ROOT)}: removed {symbol}")
        return True

    return False


def remove_entire_import(filepath: Path) -> bool:
    """Remove an entire import declaration (for TS6192)."""
    # This is tricky — we need to know WHICH import line. 
    # Better handled by ts-morph. For now, skip or use simpler heuristic.
    return False


def remove_unused_declaration(filepath: Path, symbol: str, exact_line: int) -> bool:
    """Remove an unused type/interface/function using ts-morph helper."""
    try:
        import subprocess as sp
        env = dict(os.environ)
        env["NODE_PATH"] = str(MONOREPO_ROOT / "scripts" / "deadcode-analyzer" / "node_modules")
        
        result = sp.run(
            [
                "node", str(TS_HELPER),
                "--tsconfig", str(MONOREPO_ROOT / "dashboard" / "tsconfig.app.json"),
                "--file", str(filepath.relative_to(MONOREPO_ROOT)),
                "--symbol", symbol,
                "--line", str(exact_line),
            ],
            cwd=MONOREPO_ROOT,
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
        )

        if result.returncode == 0:
            print(f"    CLEANED declaration {filepath.relative_to(MONOREPO_ROOT)}({exact_line}): removed {symbol}")
            return True
        else:
            err_msg = result.stderr.strip() or result.stdout.strip()
            # If DECL_NOT_FOUND, it may be a local var/parameter that ts-morph can't handle
            if "DECL_NOT_FOUND" in err_msg:
                print(f"    ⚠ DECL_NOT_FOUND {filepath.relative_to(MONOREPO_ROOT)}({exact_line}): {symbol} — skipping")
            else:
                print(f"    ⚠ Could not remove {symbol} from {filepath.relative_to(MONOREPO_ROOT)}({exact_line}): {err_msg}")
            return False
    except Exception as e:
        print(f"    ✗ ERROR removing {symbol} from {filepath}: {e}")
        return False


def is_in_modified_or_barrel(filepath: Path, modified_files: set[str]) -> bool:
    """Check if error is in a modified file or a barrel of a modified file."""
    rel = str(filepath.relative_to(MONOREPO_ROOT))
    if rel in modified_files:
        return True
    # Check if it's a barrel that re-exports from a modified file
    if filepath.name == "index.ts":
        content = filepath.read_text()
        for mf in modified_files:
            # Extract filename without extension
            fname = Path(mf).stem
            if fname in content:
                return True
    return False


def run_tsc_cleanup(tsconfig: str, modified_files: list[str], dry_run: bool = False, max_iterations: int = 10) -> tuple[int, int]:
    """Run tsc, auto-fix applicable errors, repeat until convergence.
    
    Returns (fixes_applied, iterations).
    """
    modified_set = set(modified_files)
    total_fixes = 0
    iteration = 0

    while iteration < max_iterations:
        iteration += 1
        print(f"\n--- tsc check iteration {iteration} ---")
        
        errors = run_tsc(tsconfig)
        fixable_errors = [e for e in errors if e["code"] in ("TS2305", "TS2307", "TS2724", "TS6133", "TS6196", "TS6192")]
        
        if not fixable_errors:
            print(f"  No fixable errors remaining.")
            break
        
        fixes_this_round = 0

        for err in fixable_errors:
            filepath = MONOREPO_ROOT / err["file"]
            code = err["code"]
            message = err["message"]

            # Safety: only auto-fix errors in modified files or their barrels
            if not is_in_modified_or_barrel(filepath, modified_set):
                continue

            if dry_run:
                print(f"    WOULD FIX {err['file']}({err['line']}): {code} — {message}")
                fixes_this_round += 1
                continue

            elif code in ("TS2305", "TS2724"):
                member = extract_exported_member(message)
                if member and filepath.name == "index.ts":
                    if remove_from_barrel(filepath, member):
                        fixes_this_round += 1

            elif code == "TS2307":
                module = extract_missing_module(message)
                if module and filepath.name == "index.ts":
                    # Remove the re-export for the missing module
                    # Heuristic: remove any export that references this module path
                    content = filepath.read_text()
                    original = content
                    content = re.sub(rf".*from\s+['\"]{re.escape(module)}['\"];?\n?", "", content)
                    if content != original:
                        filepath.write_text(content)
                        print(f"    CLEANED barrel {err['file']}: removed stale re-export for {module}")
                        fixes_this_round += 1

            elif code in ("TS6133", "TS6196"):
                symbol = extract_unused_name(message)
                if symbol:
                    if remove_unused_import(filepath, symbol):
                        fixes_this_round += 1
                    elif remove_unused_declaration(filepath, symbol, err["line"]):
                        fixes_this_round += 1

            elif code == "TS6192":
                # Entire import declaration is unused — find and remove it
                # This requires knowing the line, which we have
                lines = filepath.read_text().splitlines()
                line_idx = err["line"] - 1
                if 0 <= line_idx < len(lines):
                    import_line = lines[line_idx]
                    if re.search(r"^\s*import\s+", import_line):
                        lines.pop(line_idx)
                        filepath.write_text("\n".join(lines) + ("\n" if lines else ""))
                        print(f"    CLEANED import {err['file']}({err['line']}): removed unused import declaration")
                        fixes_this_round += 1

        if fixes_this_round == 0:
            print(f"  No fixes applied this round. Stopping.")
            break

        total_fixes += fixes_this_round
        print(f"  Fixed {fixes_this_round} errors this round.")

    # Final check
    remaining = run_tsc(tsconfig)
    fixable_remaining = [e for e in remaining if e["code"] in ("TS2305", "TS2307", "TS2724", "TS6133", "TS6196", "TS6192")]
    if fixable_remaining:
        print(f"\n⚠ {len(fixable_remaining)} fixable errors remain:")
        for e in fixable_remaining[:10]:
            print(f"    {e['file']}({e['line']}): {e['code']} — {e['message']}")

    return total_fixes, iteration


if __name__ == "__main__":
    # Standalone test
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--tsconfig", default="dashboard/tsconfig.app.json")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--modified-files", nargs="*", default=[])
    args = parser.parse_args()
    
    fixes, iters = run_tsc_cleanup(args.tsconfig, args.modified_files, args.dry_run)
    print(f"\nDone: {fixes} fixes across {iters} iterations")
