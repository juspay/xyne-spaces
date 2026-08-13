import type { BaselineDefinition } from './baselineDefinitions';

export function buildBaselineExecutionPrompt(input: {
  repoId: string;
  repoName: string;
  repoUrl: string;
  baseBranch: string;
  channelId: string;
  setupExecutionId: string;
  definition: BaselineDefinition;
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
   - markdown: compact evidence-backed Markdown that follows the output contract below`
    )
    .join('\n\n');

  return `You are executing one SDLC baseline step for ${input.repoName}.
Repository identity is server-pinned. Never use Spaces search to discover or substitute another repository.
Baseline update identifiers are also server-pinned and injected into every spaces-sdlc-mutate-artifact call.
After context compaction, never search for repoId, setupExecutionId, workflowExecutionId, or baselineKind;
omit forgotten identifier fields and call the baseline update tool with the action and section content.
Pinned URL: ${input.repoUrl}
Pinned branch: ${input.baseBranch}
Use sandbox-repo-setup exactly once for the pinned repository.
Do not edit, commit, or push repository files. Cite exact relative paths and symbols.

Artifact: ${input.definition.title}
Instructions: ${input.definition.instructions}

Baseline output contract:
- All five approved baseline documents are automatically added to every SDLC and Ask AI session.
  Write this artifact as a compact navigation brief, not as a comprehensive reference.
- Keep each section at 120 words or fewer, excluding commands. Prefer 3-7 concise bullets over prose.
- The canvas renderer adds the artifact title and each section title. Supply section body Markdown
  only; never repeat the artifact title or the current section title inside section Markdown.
- Preserve the important facts needed to orient an agent, but do not copy long Wiki passages, source
  code, configuration, exhaustive inventories, or the same fact into multiple sections.
- End every section with **Explore deeper** containing at most three high-value pointers. Use direct
  links to the most relevant imported Wiki canvases plus exact repository-relative paths and symbols
  that an agent can inspect when more detail is needed. Never use a search-result snippet as a pointer.
- If a section has no useful Wiki page, point only to the strongest repository paths and symbols.
- Optimize for small always-loaded context: state what matters, where it lives, and where to go next.

Imported Wiki evidence is required context for this baseline:
1. Before drafting, call spaces-search once with a focused query for this artifact, type: canvas, and
   in: ${input.channelId}. If search is unavailable, list canvases once and select by title.
2. Use spaces-read-canvas to read at most three high-value imported Wiki canvases for the entire
   artifact, one at a time. If a
   Wiki result is offloaded because it is large, inspect only the sections relevant to this baseline.
   Stop reading Wiki pages once every section has enough orientation evidence.
3. Use Wiki evidence to guide repository inspection, then verify material claims against the live
   pinned repository. When Wiki and source disagree, treat the live repository as authoritative and
   record the discrepancy in the baseline. If no relevant Wiki page exists, say so in the draft and
   continue from repository evidence.

Immediately after repository setup, call spaces-sdlc-mutate-artifact with:
- action: begin
${common}

Work through this persisted section plan in order. After inspecting each section, checkpoint it
before inspecting the next section. Combine related file reads and avoid dumping entire directories.

${sections}

After every section is checkpointed, call spaces-sdlc-mutate-artifact with:
- action: finalize
${common}

Then submit the returned canvas id as the structured completion result. Never create a generic canvas.`;
}
