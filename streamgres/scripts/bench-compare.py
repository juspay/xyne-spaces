#!/usr/bin/env python3
"""Compare benchmark runs of two builds and fail on a regression.

    bench-compare.py --base base-1.txt base-2.txt --head head-1.txt head-2.txt

Every file is the output of `cargo run --release --bin bench`. Each table row
that has a `us/write` or `us/register` column is one measurement, named by its
scenario, its first cell and, when that names a phase, its second. A build's value for a
measurement is the smallest over its runs (noise on a shared runner only ever
adds time). The head regresses when a measurement is slower than the base by
more than --tolerance (a ratio, default 0.30) and by more than --floor
microseconds (default 1.0), so a row of fractions of a microsecond cannot fail
on jitter. Prints a Markdown table (to $GITHUB_STEP_SUMMARY too, when set) and
exits 1 when anything regressed.
"""
import argparse
import os
import re
import sys

MEASURED = ("us/write", "us/register")


def measurements(path):
    """{(scenario, row label, column): microseconds} of one run."""
    found = {}
    scenario, header = "", None
    with open(path, encoding="utf-8") as lines:
        for raw in lines:
            line = raw.rstrip("\n")
            title = re.match(r"^== (\S+)", line)
            if title:
                scenario, header = title.group(1).rstrip("."), None
                continue
            cells = [cell for cell in re.split(r"\s{2,}", line.strip()) if cell]
            if any(name in cell for cell in cells for name in MEASURED):
                header = cells
                continue
            if header is None or not cells or set(line.strip()) <= {"-", " "}:
                if not cells:
                    header = None
                continue
            if len(cells) != len(header):
                continue
            first = min(i for i, cell in enumerate(header) if any(name in cell for name in MEASURED))
            label = cells[0]
            if first > 1 and not re.fullmatch(r"[\d_.,-]+", cells[1]):
                label += " " + cells[1]
            for index, column in enumerate(header):
                if any(name in column for name in MEASURED):
                    try:
                        found[(scenario, label, column)] = float(cells[index].replace("_", ""))
                    except ValueError:
                        pass
    return found


def best(paths):
    """The smallest value of every measurement over `paths`."""
    out = {}
    for path in paths:
        for key, value in measurements(path).items():
            out[key] = min(value, out.get(key, value))
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", nargs="+", required=True)
    parser.add_argument("--head", nargs="+", required=True)
    parser.add_argument("--tolerance", type=float, default=0.30)
    parser.add_argument("--floor", type=float, default=1.0)
    args = parser.parse_args()
    base, head = best(args.base), best(args.head)
    if not base or not head:
        print("no measurements found", file=sys.stderr)
        return 2
    rows, regressed = [], []
    for key in sorted(set(base) & set(head)):
        before, after = base[key], head[key]
        change = (after - before) / before if before else 0.0
        slower = after > before * (1 + args.tolerance) and after - before > args.floor
        if slower:
            regressed.append(key)
        rows.append((key, before, after, change, slower))
    lines = [
        f"### Benchmark, head against base (smallest of {len(args.head)} and {len(args.base)} runs, microseconds)",
        "",
        "| scenario | measurement | base | head | change | |",
        "|---|---|---:|---:|---:|---|",
    ]
    for (scenario, label, column), before, after, change, slower in rows:
        lines.append(
            f"| {scenario} | {label} {column} | {before:.1f} | {after:.1f} | {change:+.0%} | {'REGRESSED' if slower else ''} |"
        )
    only = sorted(set(head) - set(base))
    if only:
        lines += ["", f"New in head, not compared: {len(only)} measurements."]
    lines += ["", f"Tolerance {args.tolerance:.0%} and {args.floor} us; {len(regressed)} regressed."]
    text = "\n".join(lines)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write(text + "\n")
    return 1 if regressed else 0


if __name__ == "__main__":
    sys.exit(main())
