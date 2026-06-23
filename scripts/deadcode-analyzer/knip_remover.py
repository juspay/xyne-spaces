#!/usr/bin/env python3
"""
Knip-based dead code remover. Processes all categories: files, exports, types, enum members, dependencies.

Usage:
    python knip_remover.py project,boards --dry-run          # Preview all removals
    python knip_remover.py project,boards --workspace=dashboard --dry-run
    python knip_remover.py project,boards                    # Live removal
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

from knip_reporter import (
    CATEGORIES,
    CACHE_FILE,
    MONOREPO_ROOT,
    expand_keywords,
    matches_feature,
    run_knip,
)

REMOVABLE_CATEGORIES = ["files", "exports", "types", "enumMembers", "dependencies", "devDependencies"]


def remove_files(items: list[dict], dry_run: bool):
    if not items:
        print("  No files to remove.")
        return 0, 0, set()

    for item in items:
        filepath = item["file"]
        full = MONOREPO_ROOT / filepath
        exists = full.exists()
        marker = "✓" if exists else "✗ MISSING"
        print(f"    {marker} {filepath}")

    if dry_run:
        return 0, 0, set()

    deleted = 0
    failed = 0
    modified_files = set()
    for item in items:
        filepath = item["file"]
        full = MONOREPO_ROOT / filepath
        if full.exists():
            try:
                if full.is_dir():
                    shutil.rmtree(full)
                else:
                    full.unlink()
                print(f"    DELETED {filepath}")
                deleted += 1
                modified_files.add(filepath)
            except Exception as e:
                print(f"    FAILED {filepath}: {e}")
                failed += 1
        else:
            print(f"    MISSING {filepath}")
    return deleted, failed, modified_files


import subprocess


ANALYZER_ROOT = MONOREPO_ROOT / "scripts" / "deadcode-analyzer"
TS_HELPER_SCRIPT = "scripts/deadcode-analyzer/remove-declaration.cjs"


def get_workspace_info(filepath: str) -> tuple[Path | None, str | None]:
    """Walk up from the file's directory to find the nearest enclosing tsconfig.

    Returns (tsconfig_dir, tsconfig_path) or (None, None). Supports both flat
    workspaces (xyne-claw/tsconfig.json) and nested ones
    (xyne-claw-auth/backend/tsconfig.json) — same lookup rule tsc itself uses.
    """
    current = (MONOREPO_ROOT / filepath).parent

    while True:
        for name in ("tsconfig.json", "tsconfig.app.json"):
            cfg = current / name
            if cfg.exists():
                return current, str(cfg)
        if current == MONOREPO_ROOT or MONOREPO_ROOT not in current.parents:
            return None, None
        current = current.parent


def run_ts_morph(filepath: str, line_no: int, symbol: str, dry_run: bool) -> bool:
    """Call the ts-morph helper to remove a declaration."""
    workspace_root, tsconfig = get_workspace_info(filepath)
    if not workspace_root or not tsconfig:
        print(f"    ✗ NO TSCONFIG for {filepath}")
        return False

    cmd = [
        "node", TS_HELPER_SCRIPT,
        "--tsconfig", tsconfig,
        "--file", filepath,
        "--symbol", symbol,
        "--line", str(line_no),
    ]

    try:
        env = os.environ.copy()
        env["NODE_PATH"] = str(ANALYZER_ROOT / "node_modules")
        
        result = subprocess.run(
            cmd,
            cwd=MONOREPO_ROOT,
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
        )

        if result.returncode == 0:
            msg = result.stdout.strip()
            print(f"    {'WOULD EDIT' if dry_run else 'EDITED'} {filepath} (L{line_no}) :: {symbol} [{msg}]")
            return True
        else:
            err = result.stderr.strip() or result.stdout.strip()
            print(f"    ⚠ TS-MORPH {filepath} (L{line_no}) :: {symbol}: {err}")
            return False
    except Exception as e:
        print(f"    ✗ ERROR running ts-morph {filepath} (L{line_no}): {e}")
        return False


def remove_export_declaration(filepath: str, line_no: int, symbol: str, dry_run: bool, modified_files: set) -> bool:
    """Remove an exported declaration using ts-morph AST manipulation."""
    full = MONOREPO_ROOT / filepath
    if not full.exists():
        print(f"    ✗ MISSING {filepath}")
        return False

    if dry_run:
        print(f"    WOULD EDIT {filepath} (L{line_no}) :: {symbol}")
        modified_files.add(filepath)
        return True

    success = run_ts_morph(filepath, line_no, symbol, dry_run)
    if success:
        modified_files.add(filepath)
    return success


def remove_exports(items: list[dict], dry_run: bool):
    if not items:
        print("  No exports to remove.")
        return 0, 0, set()

    removed = 0
    failed = 0
    modified_files = set()
    
    # Sort by file, then by line descending (remove highest lines first to prevent shifts)
    sorted_items = sorted(
        items,
        key=lambda x: (x["file"], -x.get("line", 0))
    )
    
    for item in sorted_items:
        filepath = item["file"]
        symbol = item["name"]
        line = item.get("line")

        if not line:
            print(f"    ⚠ NO LINE INFO {filepath} :: {symbol} (skipping)")
            failed += 1
            continue

        success = remove_export_declaration(filepath, line, symbol, dry_run, modified_files)
        if success:
            removed += 1
        else:
            failed += 1

    return removed, failed, modified_files


def remove_dependencies(items: list[dict], dry_run: bool, workspace: str | None):
    """Remove unused dependencies from package.json."""
    if not items:
        print("  No dependencies to remove.")
        return 0, 0, set()

    removed = 0
    failed = 0
    modified_files = set()

    # Group by package.json file
    by_pkg: dict[str, list[dict]] = {}
    for item in items:
        pkg_file = item["file"]
        if pkg_file not in by_pkg:
            by_pkg[pkg_file] = []
        by_pkg[pkg_file].append(item)

    for pkg_file, deps in by_pkg.items():
        full = MONOREPO_ROOT / pkg_file
        if not full.exists():
            print(f"    ✗ MISSING {pkg_file}")
            failed += len(deps)
            continue

        try:
            with open(full) as f:
                pkg = json.load(f)

            dep_names = [d["name"] for d in deps]
            print(f"    {'WOULD REMOVE' if dry_run else 'REMOVING'} from {pkg_file}: {', '.join(dep_names)}")

            if not dry_run:
                for dep_name in dep_names:
                    removed_dep = False
                    for key in ["dependencies", "devDependencies", "peerDependencies"]:
                        if key in pkg and dep_name in pkg[key]:
                            del pkg[key][dep_name]
                            removed_dep = True
                    if removed_dep:
                        removed += 1
                    else:
                        failed += 1

                with open(full, "w") as f:
                    json.dump(pkg, f, indent=2)
                    f.write("\n")
                modified_files.add(pkg_file)
            else:
                removed += len(dep_names)

        except Exception as e:
            print(f"    ✗ ERROR {pkg_file}: {e}")
            failed += len(deps)

    return removed, failed, modified_files


def main():
    parser = argparse.ArgumentParser(description="Remove dead code based on Knip")
    parser.add_argument("features", help="Comma-separated keywords")
    parser.add_argument("--workspace", choices=["dashboard", "backend", "shared"])
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    parser.add_argument("--clear-cache", action="store_true")
    parser.add_argument("--skip-tsc", action="store_true", help="Skip automatic tsc error cleanup")
    parser.add_argument("--tsc-max-iterations", type=int, default=10, help="Max tsc cleanup rounds (default: 10)")
    args = parser.parse_args()

    features = [f.strip() for f in args.features.split(",") if f.strip()]
    keywords = expand_keywords(features)

    if args.clear_cache:
        cache = MONOREPO_ROOT / CACHE_FILE
        if cache.exists():
            cache.unlink()

    knip_data = run_knip()
    if not knip_data:
        print("Knip failed", file=sys.stderr)
        sys.exit(1)

    # Collect findings
    results = {cat: [] for cat, _ in CATEGORIES}

    for item in knip_data.get("issues", []):
        filepath = item.get("file", "")
        if not filepath:
            continue

        if args.workspace:
            if args.workspace == "dashboard" and not filepath.startswith("dashboard/"):
                continue
            if args.workspace == "backend" and not filepath.startswith("backend/"):
                continue
            if args.workspace == "shared" and not filepath.startswith("shared/"):
                continue

        for cat_key, _ in CATEGORIES:
            findings = item.get(cat_key, [])
            if not findings:
                continue

            for finding in findings:
                if isinstance(finding, dict):
                    name = finding.get("name", "")
                    line = finding.get("line")
                elif isinstance(finding, str):
                    name = finding
                    line = None
                else:
                    continue

                if not matches_feature(filepath, keywords):
                    continue

                results[cat_key].append({
                    "file": filepath,
                    "name": name,
                    "line": line,
                })

    # Execute removals for all supported categories
    mode = "DRY RUN" if args.dry_run else "LIVE"
    print(f"Mode: {mode}")
    print(f"Processing all removable categories")
    print()

    total_removed = 0
    total_failed = 0
    all_modified_files = set()

    for cat in REMOVABLE_CATEGORIES:
        items = results.get(cat, [])
        if not items:
            continue

        print(f"--- {cat} ({len(items)}) ---")

        if cat == "files":
            removed, failed, mod = remove_files(items, args.dry_run)
        elif cat in ("exports", "types", "enumMembers"):
            removed, failed, mod = remove_exports(items, args.dry_run)
        elif cat in ("dependencies", "devDependencies"):
            removed, failed, mod = remove_dependencies(items, args.dry_run, args.workspace)
        else:
            print(f"  Skipped (not yet supported)")
            continue

        total_removed += removed
        total_failed += failed
        all_modified_files.update(mod)
        print()

    if args.dry_run:
        print("DRY RUN complete. No changes made.")
    else:
        print(f"Done: {total_removed} removed/edited, {total_failed} failed")
        
        # Auto-fix tsc errors from our modifications.
        # Group files by their nearest tsconfig so each tsc invocation runs
        # against the project that actually owns those files. Honour
        # --workspace as a prefix filter when set.
        if all_modified_files and not args.skip_tsc:
            print()
            print("Running tsc auto-cleanup...")

            files_by_tsconfig: dict[str, list[str]] = {}
            no_tsconfig: list[str] = []
            for f in all_modified_files:
                if args.workspace and not f.startswith(args.workspace.rstrip("/") + "/"):
                    continue
                _, tsconfig = get_workspace_info(f)
                if tsconfig:
                    files_by_tsconfig.setdefault(tsconfig, []).append(f)
                else:
                    no_tsconfig.append(f)

            if not files_by_tsconfig:
                print("  No tsconfig found for modified files — skipping tsc check")
            else:
                total_fixes = 0
                for tsconfig, files in files_by_tsconfig.items():
                    rel_cfg = Path(tsconfig).relative_to(MONOREPO_ROOT)
                    print(f"  tsc cleanup for {rel_cfg} ({len(files)} files)")
                    fixes, iters = run_tsc_cleanup(tsconfig, files, max_iterations=args.tsc_max_iterations)
                    total_fixes += fixes
                print(f"  Auto-fixed {total_fixes} tsc errors across {len(files_by_tsconfig)} tsconfig(s)")
                if no_tsconfig:
                    print(f"  ({len(no_tsconfig)} file(s) had no enclosing tsconfig and were skipped)")
        
        # Cleanup empty files and directories
        print()
        print("Cleaning up empty files and directories...")
        emptied = cleanup_empty_files_and_dirs(all_modified_files)
        print(f"  Deleted {emptied} empty files/directories")
        
        print()
        print("Next steps:")
        print("  npm run build")
        print("  npm run test")


def cleanup_empty_files_and_dirs(modified_files: set[str]):
    """Delete empty .ts/.tsx files and their parent directories if they become empty.
    
    Only checks directories that contain files we actually modified.
    """
    deleted = 0
    seen_dirs: set[Path] = set()
    
    for filepath in modified_files:
        full = MONOREPO_ROOT / filepath
        if not full.exists():
            dirs_to_check = [full.parent]
        else:
            dirs_to_check = [full, full.parent]
        
        for check_path in dirs_to_check:
            current = check_path if check_path.is_dir() else check_path.parent
            while current.name != "src" and current != MONOREPO_ROOT:
                if current in seen_dirs:
                    current = current.parent
                    continue
                seen_dirs.add(current)
                
                try:
                    remaining = list(current.iterdir())
                except OSError:
                    break
                
                if not remaining:
                    try:
                        current.rmdir()
                        print(f"    DELETED empty dir {current.relative_to(MONOREPO_ROOT)}")
                        deleted += 1
                    except OSError:
                        pass
                    current = current.parent
                    continue
                
                for fpath in remaining:
                    if not fpath.is_file():
                        continue
                    if not fpath.name.endswith((".ts", ".tsx")):
                        continue
                    content = fpath.read_text().strip()
                    if not content:
                        try:
                            fpath.unlink()
                            print(f"    DELETED empty file {fpath.relative_to(MONOREPO_ROOT)}")
                            deleted += 1
                        except Exception as e:
                            print(f"    ✗ Failed to delete {fpath}: {e}")
                
                remaining = list(current.iterdir())
                if not remaining:
                    try:
                        current.rmdir()
                        print(f"    DELETED empty dir {current.relative_to(MONOREPO_ROOT)}")
                        deleted += 1
                    except OSError:
                        pass
                    current = current.parent
                    continue
                
                break
    
    return deleted


from tsc_cleanup import run_tsc_cleanup


if __name__ == "__main__":
    main()
