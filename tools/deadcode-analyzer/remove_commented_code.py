#!/usr/bin/env python3
"""
Remove commented-out code blocks (Tier 1 of the comment-cleanup plan).

A "commented-out code block" is a contiguous run of `//` comment lines where
*every* non-empty line, stripped of the `//` prefix, looks like TS/JS code by a
conservative set of heuristics. If a single line in the block looks like English
prose, the entire block is kept.

Files that end up containing only whitespace after the cleanup are deleted.

Usage:
    python remove_commented_code.py                       # DRY RUN (default)
    python remove_commented_code.py --apply               # actually edit files
    python remove_commented_code.py --workspace dashboard # scope to one workspace
    python remove_commented_code.py --path dashboard/src/components/Chat
    python remove_commented_code.py --verbose             # show each removed block
"""

import argparse
import re
import sys
from pathlib import Path

MONOREPO_ROOT = Path(__file__).resolve().parent.parent.parent

EXCLUDE_DIRS = {
    "node_modules", ".git", "dist", "build", "out", ".next",
    "coverage", ".cache", ".turbo", "generated", ".vite",
    "__pycache__", ".knip_cache.json",
}

EXCLUDE_PATH_PARTS = (
    "/prisma/generated/",
    "/.prisma/",
    "/node_modules/",
)

INCLUDE_EXT = (".ts", ".tsx")

# HARD_KEEP_PATTERNS: behaviorally load-bearing or legally required. Block removal
# at every layer (block-level AND whole-file-level).
HARD_KEEP_PATTERNS = [
    re.compile(r"eslint-disable", re.IGNORECASE),
    re.compile(r"@ts-(ignore|expect-error|nocheck|check)", re.IGNORECASE),
    re.compile(r"prettier-ignore", re.IGNORECASE),
    re.compile(r"biome-ignore", re.IGNORECASE),
    re.compile(r"@vite-ignore", re.IGNORECASE),
    re.compile(r"\bCopyright\b", re.IGNORECASE),
    re.compile(r"SPDX-License", re.IGNORECASE),
    re.compile(r"#(end)?region\b"),
]

# SOFT_KEEP_PATTERNS: human-advisory. Block block-level removal so we don't lose
# real TODOs in live code — but at the whole-file level, if the entire file is
# already commented-out, these are themselves part of the dead code.
SOFT_KEEP_PATTERNS = [
    re.compile(r"\bTODO\b", re.IGNORECASE),
    re.compile(r"\bFIXME\b", re.IGNORECASE),
    re.compile(r"\bHACK\b", re.IGNORECASE),
    re.compile(r"\bXXX\b"),
    re.compile(r"\bNOTE\b"),
    re.compile(r"\bWARNING\b", re.IGNORECASE),
    re.compile(r"\bWHY\b"),
    re.compile(r"\bXYNE-\d+"),
    re.compile(r"#\d{3,}\b"),                # GitHub-style issue refs (3+ digits)
    re.compile(r"https?://"),
    re.compile(r"\bMARK:"),
    re.compile(r"^\s*//\s*$"),                # blank `//` (often intentional spacer)
]

KEEP_PATTERNS = HARD_KEEP_PATTERNS + SOFT_KEEP_PATTERNS

CODE_START = re.compile(
    r"^\s*("
    r"import\s+|"
    r"export\s+(default\s+|const\s+|let\s+|var\s+|function\s+|async\s+function\s+|class\s+|interface\s+|type\s+|enum\s+|\{|\*)|"
    r"const\s+\w|"
    r"let\s+\w|"
    r"var\s+\w|"
    r"function\s+\w|"
    r"async\s+function\s+|"
    r"class\s+\w|"
    r"interface\s+\w|"
    r"type\s+\w+\s*[=<]|"
    r"enum\s+\w|"
    r"namespace\s+\w|"
    # TS access/modifier keywords on class members
    r"(public|private|protected|static|readonly|abstract|override|async|get|set|declare)\s+(\w|\[)|"
    r"#\w+\s*[\(:]|"                       # private fields like #foo() or #foo:
    r"if\s*\(|"
    r"else\s*\{|"
    r"else\s+if\s*\(|"
    r"for\s*\(|"
    r"while\s*\(|"
    r"do\s*\{|"
    r"switch\s*\(|"
    r"case\s+[\w'\"]+\s*:|"
    r"default\s*:|"
    r"return[\s;]|"
    r"return$|"
    r"await\s+\w|"
    r"yield\s+|"
    r"throw\s+\w|"
    r"try\s*\{|"
    r"catch\s*\(|"
    r"finally\s*\{|"
    r"break;?$|"
    r"continue;?$"
    r")"
)

CODE_END = re.compile(r"[{};,)\]]\s*$|=>\s*\{?\s*$|=\s*$|\?\s*$")

JSX_TAG = re.compile(r"^\s*</?[A-Z][\w.]*(\s+[\w-]+(=\{?[\w\"']|=\"|=\{|\s|/?>)|/?>|\s*>)")
JSX_CLOSE = re.compile(r"^\s*</[A-Z][\w.]*\s*>\s*$")

OBJECT_KEY_VALUE = re.compile(r"^\s*[\w\"']+\s*:\s*[\w\"'\[\{`(]")

ASSIGNMENT = re.compile(r"^\s*\w[\w.]*\s*(=|\+=|-=|\*=|/=|\?\?=|\|\|=|&&=)\s*")

METHOD_CALL = re.compile(r"^\s*\w[\w.]*\s*\([^)]*\)\s*[;.,)]?\s*$")

CHAINED_METHOD = re.compile(r"^\s*\.\w+\s*\(")

DESTRUCTURING = re.compile(r"^\s*(const|let|var)\s+(\{|\[)")

ONLY_PUNCT = re.compile(r"^[\s/\\{}\[\]();,.<>=+\-*&|!?:`'\"]+$")


def looks_like_code(stripped: str) -> bool:
    """Conservative classifier: returns True only with strong signal of TS/JS."""
    s = stripped.strip()
    if not s:
        return False
    # Banner separators ("======", "------", "******") — inert decoration inside
    # commented-out regions, treated as code-shape so they don't kill the block.
    if re.match(r"^[\s=\-\*_~/\\]{4,}$", s):
        return True
    # Commented-out comment ("// // foo" stripped once becomes "// foo")
    # or commented-out JSDoc ("// /**", "// * desc", "// */") — these are
    # remnants of a former code region that included its own comments.
    if s.startswith("//") or s.startswith("/*") or s.startswith("*/"):
        return True
    if s.startswith("* ") or s == "*":
        return True
    # A line that's only punctuation/operators is suspicious as code
    if ONLY_PUNCT.match(s) and any(c in s for c in "{};,()[]"):
        return True
    if CODE_START.match(s):
        return True
    # Block-continuation patterns: `} else {`, `} catch (`, `} finally {`, `}.method(`
    if re.match(r"^\}\s*(else\s*(\{|if\s*\()|catch\s*\(|finally\s*\{|\.\w+\s*\()", s):
        return True
    if JSX_TAG.match(s) or JSX_CLOSE.match(s):
        return True
    if DESTRUCTURING.match(s):
        return True
    if CHAINED_METHOD.match(s):
        return True
    # Chained method/property terminus: `}).optional(),` `})).method({...}),`
    # Closing brackets followed by `.identifier(` or `[` — strong code signal.
    if re.match(r"^[\)\]\}]+\s*\.\w+\s*[\(\[]", s) or re.search(r"\)\s*\.\w+\(", s):
        return True
    # OBJECT_KEY_VALUE: `key: codestart-char...` — pattern itself is strong enough.
    if OBJECT_KEY_VALUE.match(s):
        return True
    # Shorthand object property or destructured field: `identifier,`, `identifier.prop,`,
    # or spread `...x,`. Rare in English prose at the start of a line.
    if re.match(r"^[\w$][\w.$]*\s*,\s*$", s) or re.match(r"^\.\.\.\w+\s*,?\s*$", s):
        return True
    # Lone dotted identifier (e.g. `obj.prop` as a standalone argument-list line).
    # Requires the dot — plain words alone would be false-positive risk.
    if re.match(r"^[\w$]+\.[\w$.]+\s*$", s):
        return True
    # String literal alone or with trailing comma — common in array/argument list rows.
    if re.match(r"^['\"`].*['\"`]\s*,?\s*$", s):
        return True
    # Multi-line method call opener: `func(arg,` `func({` `func([` — starts with
    # an identifier + open-paren and ends with a continuation char.
    if re.match(r"^[\w$][\w.$]*\s*\(.*[,{[]\s*$", s):
        return True
    # ASSIGNMENT: `name = ...` at line start. English prose almost never starts
    # a line with `word = value`. Stronger than the trailing terminator check.
    if ASSIGNMENT.match(s):
        return True
    if METHOD_CALL.match(s):
        return True
    # TS-specific token cluster: typeof/as/?./?? — catches multi-line conditional
    # expressions like ternary returns.
    ts_tokens = sum(1 for tok in ("typeof ", " as ", "?.", "??", "instanceof ",
                                   ": string", ": number", ": boolean",
                                   "await ", "=>") if tok in s)
    if ts_tokens >= 2:
        return True
    # Lone closing brace variants
    if s in ("}", "};", "})", "});", "})}", "}));", "],", "];", "]", ")", "),", ");",
             "})),", "}));", "});,"):
        return True
    return False


def should_keep_block(lines: list[str]) -> bool:
    """True if ANY line in the block matches a hard or soft keep-pattern."""
    joined = "\n".join(lines)
    for pat in KEEP_PATTERNS:
        if pat.search(joined):
            return True
    return False


def has_hard_keep(lines: list[str]) -> bool:
    """True if ANY line matches a HARD keep (load-bearing directives/license).

    Used only at the whole-file-deletion layer; SOFT keeps (TODO/WARNING) inside
    a fully-commented-out file are themselves dead and shouldn't preserve the file.
    """
    joined = "\n".join(lines)
    for pat in HARD_KEEP_PATTERNS:
        if pat.search(joined):
            return True
    return False


def is_commented_code_block(lines: list[str]) -> bool:
    """True if the block's `//` content looks like code.

    Rules:
      - Blank lines (no `//` prefix) inside a soft-merged block are skipped.
      - Blank `//` lines (just `//` with no body) are skipped.
      - Small blocks (<15 lines): require 100% code-shape.
      - Large blocks (≥15 lines): tolerate up to 15% embedded prose; this catches
        the "entire function commented out with one or two English notes inside"
        pattern without opening false-positives on small mixed prose+code blocks.
    """
    code_lines = 0
    prose_lines = 0
    nonblank_lines = 0
    size = len(lines)
    # Tiered thresholds: stricter for small blocks, looser for large ones,
    # because at scale a few embedded prose comments inside a hundreds-of-lines
    # commented-out region are overwhelmingly likely to themselves be dead.
    if size < 15:
        threshold = 1.0          # 100% required
    elif size < 50:
        threshold = 0.85
    elif size < 100:
        threshold = 0.75
    else:
        threshold = 0.70
    for ln in lines:
        # Blank source line (gap inside soft-merged block) — skip
        if not ln.strip():
            continue
        m = re.match(r"^\s*//\s?(.*)$", ln)
        if not m:
            # A truly non-`//` non-blank line inside the block means our
            # merging let through something unrelated — reject.
            return False
        body = m.group(1)
        if not body.strip():
            # Blank `//` line inside the block: tolerated
            continue
        nonblank_lines += 1
        if looks_like_code(body):
            code_lines += 1
        else:
            prose_lines += 1
            if threshold >= 1.0:
                return False
    if nonblank_lines == 0:
        return False
    return (code_lines / nonblank_lines) >= threshold


def find_comment_blocks(lines: list[str]):
    """Yield (start_idx, end_idx_exclusive, block_lines) for each `//` block.

    Soft boundary: blank lines between `//` runs are merged into one logical block
    (catches the "entire-file commented-out" pattern where the original code had
    blank-line gaps that are preserved after `//`-prefixing).
    """
    i = 0
    n = len(lines)
    line_comment_re = re.compile(r"^\s*//")
    blank_re = re.compile(r"^\s*$")
    while i < n:
        if line_comment_re.match(lines[i]):
            start = i
            # Extend while we see `//` lines OR blank lines that are flanked
            # by another `//` line within a small lookahead.
            while i < n:
                if line_comment_re.match(lines[i]):
                    i += 1
                    continue
                if blank_re.match(lines[i]):
                    # Look ahead: does another `//` line resume within a few blanks?
                    j = i
                    while j < n and blank_re.match(lines[j]):
                        j += 1
                    if j < n and line_comment_re.match(lines[j]) and (j - i) <= 3:
                        i = j
                        continue
                break
            yield start, i, lines[start:i]
        else:
            i += 1


def has_soft_keep(lines: list[str]) -> bool:
    """True if ANY line matches a soft keep (TODO/URL/WARNING/etc.)."""
    joined = "\n".join(lines)
    for pat in SOFT_KEEP_PATTERNS:
        if pat.search(joined):
            return True
    return False


def process_file(path: Path, apply: bool, verbose: bool) -> dict:
    """Return stats dict: {lines_removed, blocks_removed, deleted_file, skipped_blocks}."""
    text = path.read_text(encoding="utf-8", errors="replace")
    # Preserve original line endings: process by line, rejoin with '\n' (TS source assumed LF)
    original_lines = text.splitlines(keepends=False)
    if not original_lines:
        return {"lines_removed": 0, "blocks_removed": 0, "deleted_file": False, "skipped_blocks": 0}

    # FAST PATH: "entire file commented-out" detection.
    # If >70% of non-blank lines are `//`-prefixed and no surviving line trips a
    # keep-guard, the whole file is treated as one dead block and the file is
    # marked for deletion.
    non_blank = [ln for ln in original_lines if ln.strip()]
    line_comment_re = re.compile(r"^\s*//")
    comment_lines = [ln for ln in non_blank if line_comment_re.match(ln)]
    if non_blank and len(comment_lines) / len(non_blank) > 0.70:
        # At the whole-file layer only HARD keeps block — TODO/WARNING/etc inside
        # a fully-commented-out file are themselves part of the dead code.
        if not has_hard_keep(original_lines):
            non_comment_remnants = [ln for ln in non_blank if not line_comment_re.match(ln)]
            # The remaining non-comment lines must themselves be code-shape (the comments
            # were stripped from an actively-used file = unusual) OR be empty. Defensive:
            # if there are >5 non-comment non-blank lines, this isn't a fully-dead file.
            if len(non_comment_remnants) <= 5:
                if verbose:
                    print(f"  [WHOLE-FILE DEAD] {path.relative_to(MONOREPO_ROOT)} "
                          f"({len(comment_lines)}/{len(non_blank)} non-blank lines are `//`)")
                if apply:
                    path.unlink()
                return {
                    "lines_removed": len(original_lines),
                    "blocks_removed": 1,
                    "deleted_file": True,
                    "skipped_blocks": 0,
                }

    to_remove: set[int] = set()
    blocks_removed = 0
    skipped_blocks = 0

    for start, end, block in find_comment_blocks(original_lines):
        # Single-line block: skip — only act on 2+ line code blocks per user's tier-1 spec
        # (also matches the spec discussed: contiguous `//` block)
        if end - start < 2:
            continue
        # Per-block guard: large blocks (≥30 lines) only honor HARD keeps —
        # a URL/TODO/WARNING inside a 200-line commented-out block is itself
        # part of the dead code, not a live annotation. Small blocks honor both.
        block_size = end - start
        if block_size >= 30:
            if has_hard_keep(block):
                skipped_blocks += 1
                continue
        else:
            if should_keep_block(block):
                skipped_blocks += 1
                continue
        if not is_commented_code_block(block):
            skipped_blocks += 1
            continue
        # Mark every line in this block for removal
        for idx in range(start, end):
            to_remove.add(idx)
        blocks_removed += 1
        if verbose:
            print(f"  {path.relative_to(MONOREPO_ROOT)}:L{start+1}-L{end} ({end-start} lines)")
            for ln in block[:3]:
                print(f"      {ln.rstrip()}")
            if len(block) > 3:
                print(f"      ...({len(block)-3} more)")

    if not to_remove:
        return {"lines_removed": 0, "blocks_removed": 0, "deleted_file": False, "skipped_blocks": skipped_blocks}

    new_lines = [ln for i, ln in enumerate(original_lines) if i not in to_remove]
    # Trim leading/trailing fully-blank lines to detect "only whitespace remains"
    stripped_remaining = "\n".join(new_lines).strip()
    deleted = False

    if not stripped_remaining:
        # File now contains nothing useful
        if apply:
            path.unlink()
        deleted = True
    else:
        if apply:
            # Preserve trailing newline if original had one
            trailing = "\n" if text.endswith("\n") else ""
            path.write_text("\n".join(new_lines) + trailing, encoding="utf-8")

    return {
        "lines_removed": len(to_remove),
        "blocks_removed": blocks_removed,
        "deleted_file": deleted,
        "skipped_blocks": skipped_blocks,
    }


def iter_target_files(root: Path):
    candidates = [root] if root.is_file() else root.rglob("*")
    for p in candidates:
        if not p.is_file():
            continue
        if not p.name.endswith(INCLUDE_EXT):
            continue
        parts = p.parts
        if any(part in EXCLUDE_DIRS for part in parts):
            continue
        rel = str(p)
        if any(seg in rel for seg in EXCLUDE_PATH_PARTS):
            continue
        # Skip declaration files — often intentional shims
        if p.name.endswith(".d.ts"):
            continue
        yield p


def main():
    ap = argparse.ArgumentParser(
        description="Remove commented-out code blocks (Tier 1).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--apply", action="store_true",
                    help="Actually edit files (default is dry-run preview)")
    ap.add_argument("--workspace",
                    help="Restrict to a workspace directory under monorepo root (e.g. dashboard, backend)")
    ap.add_argument("--path",
                    help="Restrict to a specific subdirectory (relative to monorepo root)")
    ap.add_argument("--verbose", "-v", action="store_true",
                    help="Show each removed block")
    ap.add_argument("--top", type=int, default=20,
                    help="Show top N files by removal count in the summary (default 20)")
    args = ap.parse_args()

    root = MONOREPO_ROOT
    if args.path:
        root = (MONOREPO_ROOT / args.path).resolve()
    elif args.workspace:
        root = (MONOREPO_ROOT / args.workspace).resolve()
    if not root.exists():
        print(f"ERROR: scope path does not exist: {root}", file=sys.stderr)
        sys.exit(2)

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"Mode: {mode}")
    print(f"Scope: {root.relative_to(MONOREPO_ROOT) if root != MONOREPO_ROOT else '<monorepo root>'}")
    print()

    per_file = []
    total_lines = 0
    total_blocks = 0
    total_files_touched = 0
    total_files_deleted = 0
    total_skipped = 0

    for f in iter_target_files(root):
        stats = process_file(f, apply=args.apply, verbose=args.verbose)
        if stats["lines_removed"] == 0:
            total_skipped += stats["skipped_blocks"]
            continue
        per_file.append((f, stats))
        total_lines += stats["lines_removed"]
        total_blocks += stats["blocks_removed"]
        total_files_touched += 1
        if stats["deleted_file"]:
            total_files_deleted += 1
        total_skipped += stats["skipped_blocks"]

    per_file.sort(key=lambda x: -x[1]["lines_removed"])

    print(f"=== Summary ===")
    print(f"  Files touched:        {total_files_touched}")
    print(f"  Files fully deleted:  {total_files_deleted}")
    print(f"  Blocks removed:       {total_blocks}")
    print(f"  Lines removed:        {total_lines}")
    print(f"  Blocks skipped (kept by guard or not code-shaped): {total_skipped}")
    print()
    if per_file:
        print(f"=== Top {min(args.top, len(per_file))} files by removed lines ===")
        for f, stats in per_file[:args.top]:
            rel = f.relative_to(MONOREPO_ROOT)
            marker = " [DELETED]" if stats["deleted_file"] else ""
            print(f"  {stats['lines_removed']:>5} lines / {stats['blocks_removed']:>3} blocks{marker}  {rel}")
    if not args.apply:
        print()
        print("(DRY-RUN — no files were modified. Re-run with --apply to commit changes.)")


if __name__ == "__main__":
    main()
