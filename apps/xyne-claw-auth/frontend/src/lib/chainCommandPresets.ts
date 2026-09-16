export interface ChainCommandPreset {
  key: string;
  label: string;
  description: string;
  mustMatch: string[];
  mustNotMatch: string[];
}

const EDIT_PATTERN = "/apply_patch|sed -i|git apply|patch -p[0-9]|(^| )tee |cat *>/";

export const CHAIN_COMMAND_PRESETS: ChainCommandPreset[] = [
  {
    key: "code-committed",
    label: "Code was committed",
    description: "A tool call ran git commit.",
    mustMatch: ["git commit"],
    mustNotMatch: [],
  },
  {
    key: "code-pushed",
    label: "Code was pushed",
    description: "A tool call ran git push.",
    mustMatch: ["git push"],
    mustNotMatch: [],
  },
  {
    key: "files-edited",
    label: "Files were edited",
    description: "A tool call patched or wrote a file (apply_patch / sed -i / git apply / redirect).",
    mustMatch: [EDIT_PATTERN],
    mustNotMatch: [],
  },
  {
    key: "pr-created",
    label: "A PR was created",
    description: "A create_pull_request tool was called.",
    mustMatch: ["create_pull_request"],
    mustNotMatch: [],
  },
  {
    key: "tests-run",
    label: "Tests were run",
    description: "A common test runner was invoked (npm/pnpm/yarn test, vitest, jest, pytest, go test, cargo test).",
    mustMatch: ["/(npm|pnpm|yarn|bun) (run )?test|vitest|jest|pytest|go test|cargo test/"],
    mustNotMatch: [],
  },
  {
    key: "no-code-changes",
    label: "No code changes",
    description: "Blocks the edge if anything committed, pushed, or edited a file.",
    mustMatch: [],
    mustNotMatch: ["git commit", "git push", EDIT_PATTERN],
  },
];

export function parseCommandCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function formatCommandCsv(entries: string[]): string {
  return entries.join(", ");
}

export interface ChainCommandFields {
  commandsMustMatch: string;
  commandsMustNotMatch: string;
}

export function isChainCommandPresetActive(fields: ChainCommandFields, preset: ChainCommandPreset): boolean {
  const must = parseCommandCsv(fields.commandsMustMatch);
  const mustNot = parseCommandCsv(fields.commandsMustNotMatch);
  if (preset.mustMatch.length === 0 && preset.mustNotMatch.length === 0) return false;
  return (
    preset.mustMatch.every((pattern) => must.includes(pattern)) &&
    preset.mustNotMatch.every((pattern) => mustNot.includes(pattern))
  );
}

export function toggleChainCommandPreset(
  fields: ChainCommandFields,
  preset: ChainCommandPreset,
): ChainCommandFields {
  const active = isChainCommandPresetActive(fields, preset);
  const must = parseCommandCsv(fields.commandsMustMatch);
  const mustNot = parseCommandCsv(fields.commandsMustNotMatch);

  if (active) {
    const otherActive = CHAIN_COMMAND_PRESETS.filter(
      (candidate) => candidate.key !== preset.key && isChainCommandPresetActive(fields, candidate),
    );
    const keepMust = new Set(otherActive.flatMap((candidate) => candidate.mustMatch));
    const keepMustNot = new Set(otherActive.flatMap((candidate) => candidate.mustNotMatch));
    return {
      commandsMustMatch: formatCommandCsv(
        must.filter((entry) => !preset.mustMatch.includes(entry) || keepMust.has(entry)),
      ),
      commandsMustNotMatch: formatCommandCsv(
        mustNot.filter((entry) => !preset.mustNotMatch.includes(entry) || keepMustNot.has(entry)),
      ),
    };
  }

  const nextMust = [...must];
  for (const pattern of preset.mustMatch) if (!nextMust.includes(pattern)) nextMust.push(pattern);
  const nextMustNot = [...mustNot];
  for (const pattern of preset.mustNotMatch) if (!nextMustNot.includes(pattern)) nextMustNot.push(pattern);
  return {
    commandsMustMatch: formatCommandCsv(nextMust),
    commandsMustNotMatch: formatCommandCsv(nextMustNot),
  };
}

export function chainCommandFieldsHaveCustomEntries(fields: ChainCommandFields): boolean {
  const activePresets = CHAIN_COMMAND_PRESETS.filter((preset) => isChainCommandPresetActive(fields, preset));
  const covered = new Set([
    ...activePresets.flatMap((preset) => preset.mustMatch),
    ...activePresets.flatMap((preset) => preset.mustNotMatch),
  ]);
  const entries = [
    ...parseCommandCsv(fields.commandsMustMatch),
    ...parseCommandCsv(fields.commandsMustNotMatch),
  ];
  return entries.some((entry) => !covered.has(entry));
}
