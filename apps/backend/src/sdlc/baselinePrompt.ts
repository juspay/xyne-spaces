import type { BaselineDefinition } from './baselineDefinitions';
import type { BaselineWikiState } from './baselineWikiContext';

export function buildBaselineExecutionPrompt(input: {
  repoId: string;
  repoName: string;
  repoUrl: string;
  baseBranch: string;
  channelId: string;
  setupExecutionId: string;
  definition: BaselineDefinition;
  wikiState: BaselineWikiState;
  generationCommit: string;
}): string {
  const common = `- repoId: ${input.repoId}\n- artifactType: BASELINE\n- baselineKind: ${input.definition.kind}\n- setupExecutionId: ${input.setupExecutionId}\n- workflowExecutionId: ${input.setupExecutionId}\n- title: ${input.definition.title}`;
  const sections = input.definition.sections
    .map(
      (
        section,
        index
      ) => `${index + 1}. Inspect only the files needed for **${section.title}**. ${section.instructions}
   Then call spaces-sdlc-mutate-artifact with:
   - action: upsert_section
   ${common}
   - sectionKey: ${section.key}
   - sectionTitle: ${section.title}
   - markdown: compact evidence-backed Markdown that follows the output contract below
   - sourceReferences: structured references used by this section's \`[[source:N]]\` tokens`
    )
    .join('\n\n');

  const wikiInstructions =
    input.wikiState === 'AVAILABLE'
      ? `A completed Wiki is available as orientation evidence:
1. Call spaces-search once with a focused query for this artifact, type: canvas, and in: ${input.channelId}.
2. Read at most three high-value Wiki canvases for the entire artifact with spaces-read-canvas.
3. The Wiki may describe an older commit. State that limitation when relevant and verify every material Wiki claim against the live pinned repository. The repository is authoritative.`
      : input.wikiState === 'GENERATING'
        ? `Wiki generation is still in progress. Do not wait or poll, but existing Wiki pages remain available as provisional orientation evidence:
1. Call spaces-search once with a focused query for this artifact, type: canvas, and in: ${input.channelId}.
2. Read at most three high-value existing Wiki canvases for the entire artifact with spaces-read-canvas.
3. Warn that Wiki evidence may be partial, stale, or internally inconsistent. Verify every material claim against the live pinned repository; the repository is authoritative.`
        : `No completed current Wiki run is available. Older or partially generated Wiki pages may still exist and remain usable as provisional orientation evidence:
1. Call spaces-search once with a focused query for this artifact, type: canvas, and in: ${input.channelId}.
2. Read at most three high-value existing Wiki canvases for the entire artifact with spaces-read-canvas. If none exist, continue without them.
3. Warn that their generation status and commit freshness are unknown. Verify every material claim against the live pinned repository; the repository is authoritative.`;

  return `You are executing one SDLC baseline step for ${input.repoName}.
Repository identity is server-pinned. Never use Spaces search to discover or substitute another repository.
Baseline update identifiers are also server-pinned and injected into every spaces-sdlc-mutate-artifact call.
After context compaction, never search for repoId, setupExecutionId, workflowExecutionId, or baselineKind;
omit forgotten identifier fields and call the baseline update tool with the action and section content.
Pinned URL: ${input.repoUrl}
Pinned branch: ${input.baseBranch}
Pinned generation commit: ${input.generationCommit}
Use sandbox-repo-setup exactly once for the pinned repository.
After setup, detach the sandbox at the pinned generation commit before inspection.
Inspect and cite that commit. Do not cite a moving branch head.
Do not edit, commit, or push repository files. Cite exact relative paths and symbols.

Artifact: ${input.definition.title}
Instructions: ${input.definition.instructions}

Baseline output contract:
- All approved baseline documents are automatically added to every SDLC and Ask AI session.
  Write this artifact as a compact navigation brief, not as a comprehensive reference.
- Keep each section at 120 words or fewer, excluding commands. Prefer 3-7 concise bullets over prose.
- The canvas renderer adds the artifact title and each section title. Supply section body Markdown
  only; never repeat the artifact title or the current section title inside section Markdown.
- Preserve the important facts needed to orient an agent, but do not copy long Wiki passages, source
  code, configuration, exhaustive inventories, or the same fact into multiple sections.
- End every section with **Explore deeper** containing at most three high-value pointers. When a
  relevant Wiki page exists, use its direct canvas link plus exact repository-relative paths and
  symbols, while preserving the applicable freshness warning. Never use a search-result snippet.
- For every repository file pointer, place a zero-based \`[[source:N]]\` token in Markdown and submit
  its path, optional symbol, and trusted line range in \`sourceReferences\`. Never construct a GitHub URL.
- Optimize for small always-loaded context: state what matters, where it lives, and where to go next.

Wiki evidence policy:
${wikiInstructions}

Immediately after repository setup, call spaces-sdlc-mutate-artifact with:
- action: begin
${common}

Work through this persisted section plan in order. After inspecting each section, checkpoint it
before inspecting the next section. Combine related file reads and avoid dumping entire directories.

${sections}

After every section is checkpointed, call spaces-sdlc-mutate-artifact with:
- action: finalize
${common}

Submit only after finalize succeeds. If any mutation fails, correct its arguments and retry it.
Then submit the returned canvas id as the structured completion result. Never create a generic canvas.`;
}
