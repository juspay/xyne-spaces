import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanText } from "./index.js";

const KB = 1024;
const WORDS = (
  "the vendor sent a revised quote today and finance will review the contract before the release team meeting on " +
  "thursday where we plan the migration of the staging service and update the wiki with release notes a checklist " +
  "for support and a summary of customer tickets invoices and budget reports that the deploy pipeline publishes " +
  "every week while latency errors are tracked by the on-call engineer who files a ticket for each regression"
).split(" ");
// Clauses that walk most of a phrase or regex and then diverge, so the matcher and the regexes do real work.
const NEAR_MISS = [
  "ignore the previous email", "disregard the earlier draft", "forward all the invoices", "to the class of 2026",
  "before using this feature read the docs", "-----BEGIN PUBLIC KEY-----", "curl -s https://api.example.com/items | jq .",
  "![logo](https://cdn.example.com/logo.png?v=2)", "api_key: see the vault", "bearer token rotation is due",
  `https://example.com/search?q=${"x".repeat(30)}`, "new instructions arrive monday", "the system prompt was discussed",
  "from now on we meet weekly", "you are not on the list", "waiting for the approval of finance", "see gov-uk for details",
  "wget -qO- https://x.example/a.tgz | tar xz", `${"AKIA"}SHORT`, "do not tell anyone yet", "add this to your calendar",
];

function lcg(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

function prose(bytes: number, extras: readonly string[] = []): string {
  const r = lcg(bytes + extras.length);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  let out = "";
  for (let s = 0; out.length < bytes; s++) {
    const words = Array.from({ length: 8 + Math.floor(r() * 9) }, () => pick(WORDS));
    if (extras.length > 0 && s % 2 === 0) words.splice(Math.floor(r() * words.length), 0, pick(extras));
    const sentence = words.join(" ");
    out += sentence[0]!.toUpperCase() + sentence.slice(1) + (r() < 0.1 ? "!" : ".") + (s % 6 === 5 ? "\n\n" : " ");
  }
  return out.slice(0, bytes);
}

const inputs = (): Array<[name: string, text: string, runs: number]> => [
  ["prose-2kb", prose(2 * KB), 200],
  ["prose-20kb", prose(20 * KB), 100],
  ["prose-100kb", prose(100 * KB), 50],
  ["prose-1mb", prose(1024 * KB), 10],
  ["near-miss-100kb", prose(100 * KB, NEAR_MISS), 50],
  // One unit that NFKD expands to 18: the worst case for the normaliser.
  ["nfkc-expanding-128kb", "ﷺ".repeat(43690), 10],
  ["curl-flood-128kb", "curl ".repeat(26214), 10],
];
// The default profile truncates at 128 KB; the bench measures the scanner on the whole input.
const OPTS = { profile: { maxBytes: 4 * 1024 * KB } };

const pct = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;

function measure(text: string, runs: number): { p50: number; p99: number } {
  const input = { text, kind: "tool_result" as const };
  for (let i = 0; i < 3; i++) scanText(input, OPTS);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    scanText(input, OPTS);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { p50: pct(times, 0.5), p99: pct(times, 0.99) };
}

describe.skipIf(process.env.GOV_BENCH !== "1")("scanText bench", () => {
  it("keeps p99 within 3x the baseline for this machine class", () => {
    const baseline = JSON.parse(readFileSync(new URL("./bench-baseline.json", import.meta.url), "utf8")) as Record<string, Record<string, number>>;
    const wanted = process.env.GOV_BENCH_CLASS ?? "local";
    const cls = wanted in baseline ? wanted : "ubuntu-latest";
    const rows = inputs().map(([name, text, runs]) => ({ name, ...measure(text, runs), limit: 3 * (baseline[cls]?.[name] ?? 0) }));
    const report = rows.map((r) => `${r.name}: p50 ${r.p50.toFixed(3)} ms, p99 ${r.p99.toFixed(3)} ms, limit ${r.limit} ms`).join("\n");
    const over = rows.filter((r) => !(r.p99 <= r.limit)).map((r) => r.name);
    expect(over, `bench class "${cls}"${cls === wanted ? "" : ` (no entry for "${wanted}")`}\n${report}`).toEqual([]);
  }, 180_000);
});
