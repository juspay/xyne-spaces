#!/usr/bin/env python3
"""
Knip-based dead code reporter. Filters by feature keywords, relies on Knip.

Usage:
    python knip_reporter.py project,boards
    python knip_reporter.py project,boards --workspace=dashboard
    python knip_reporter.py project,boards --format=markdown > report.md
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

MONOREPO_ROOT = Path(__file__).parent.parent.parent
CACHE_FILE = ".knip_cache.json"
CACHE_MAX_AGE_MINUTES = 30

CATEGORIES = [
    ("files", "Unused Files"),
    ("dependencies", "Unused Dependencies"),
    ("devDependencies", "Unused DevDependencies"),
    ("optionalPeerDependencies", "Optional Peer Dependencies"),
    ("unlisted", "Unlisted Dependencies"),
    ("binaries", "Unlisted Binaries"),
    ("exports", "Unused Exports"),
    ("types", "Unused Types"),
    ("enumMembers", "Unused Enum Members"),
    ("duplicates", "Duplicate Exports"),
]


def run_knip() -> dict:
    cache_path = MONOREPO_ROOT / CACHE_FILE
    import time
    if cache_path.exists():
        age = (time.time() - cache_path.stat().st_mtime) / 60
        if age < CACHE_MAX_AGE_MINUTES:
            with open(cache_path) as f:
                return json.load(f)

    try:
        result = subprocess.run(
            ["npx", "knip", "--config", str(MONOREPO_ROOT / "knip.jsonc"),
             "--reporter", "json", "--no-progress"],
            capture_output=True, text=True, cwd=str(MONOREPO_ROOT), timeout=120,
        )
        output = result.stdout
        json_start = output.find("{")
        if json_start == -1:
            return {}
        data = json.loads(output[json_start:])
        with open(cache_path, "w") as f:
            json.dump(data, f)
        return data
    except Exception:
        return {}


def expand_keywords(raw: list[str]) -> set[str]:
    keywords = set()
    for f in raw:
        f = f.strip().lower()
        if not f:
            continue
        keywords.add(f)
        keywords.add(f + "s")
        if f.endswith("s"):
            keywords.add(f[:-1])
    return keywords


def matches_feature(filepath: str, keywords: set[str]) -> bool:
    """Check if filepath contains any keyword as a word boundary match."""
    import re
    path = filepath.lower()
    for kw in keywords:
        if re.search(rf'(^|[/_.\-]){re.escape(kw)}([/_.\-]|$)', path):
            return True
    return False


def main():
    parser = argparse.ArgumentParser(description="Knip dead code reporter")
    parser.add_argument("features", help="Comma-separated keywords")
    parser.add_argument("--workspace", choices=["dashboard", "backend", "shared"])
    parser.add_argument("--format", choices=["table", "markdown"], default="table")
    parser.add_argument("--clear-cache", action="store_true")
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

    # Filter and organize by category
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

        for cat_key, cat_label in CATEGORIES:
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

                # Only include if the file path matches our feature keywords
                if not matches_feature(filepath, keywords):
                    continue

                results[cat_key].append({
                    "file": filepath,
                    "name": name,
                    "line": line,
                    "raw": finding,
                })

    # Output
    if args.format == "markdown":
        print(f"# Knip Report: {', '.join(features)}")
        print()
        for cat_key, cat_label in CATEGORIES:
            items = results[cat_key]
            if not items:
                continue
            print(f"## {cat_label} ({len(items)})")
            print()
            if cat_key == "files":
                print("| File |")
                print("|------|")
                for item in items:
                    print(f"| `{item['file']}` |")
            else:
                print("| File | Symbol | Line |")
                print("|------|--------|------|")
                for item in items:
                    line = item.get("line") or "-"
                    print(f"| `{item['file']}` | {item['name']} | {line} |")
            print()
        print("---")
        print("*Verify with `npm run build` before deleting.*")
    else:
        print(f"Knip Report: {', '.join(features)} [{args.workspace or 'all'}]")
        print("=" * 80)
        total = 0
        for cat_key, cat_label in CATEGORIES:
            items = results[cat_key]
            if not items:
                continue
            total += len(items)
            print()
            print(f"--- {cat_label} ({len(items)}) ---")
            for item in items:
                line = f" (L{item['line']})" if item.get("line") else ""
                if cat_key == "files":
                    print(f"  {item['file']}{line}")
                else:
                    print(f"  {item['file']}{line} :: {item['name']}")
        print()
        print(f"TOTAL: {total} findings")


if __name__ == "__main__":
    main()
