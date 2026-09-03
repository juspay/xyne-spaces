import type { SdlcBaselineKind } from '@xyne/shared';
import { BASELINE_DEFINITIONS } from './baselineDefinitions';

export type BaselineGenerationStatus = 'GENERATING' | 'READY';

export interface BaselineDraftSection {
  title: string;
  markdown: string;
  sourceReferences: BaselineSourceReference[];
}

export interface BaselineSourceReference {
  path: string;
  commitSha: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
}

type Metadata = Record<string, unknown>;

function normalizeHeading(value: string): string {
  return value.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function stripRendererOwnedHeadings(markdown: string, sectionTitle: string): string {
  const lines = markdown.trim().split('\n');
  const normalizedSectionTitle = normalizeHeading(sectionTitle);

  while (lines.length > 0) {
    while (lines[0]?.trim() === '') lines.shift();
    const heading = lines[0]?.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!heading) break;

    const isDocumentTitle = heading[1] === '#';
    const isSectionTitle = normalizeHeading(heading[2]) === normalizedSectionTitle;
    if (!isDocumentTitle && !isSectionTitle) break;
    lines.shift();
  }

  return lines.join('\n').trim();
}

function definitionFor(kind: SdlcBaselineKind) {
  const definition = BASELINE_DEFINITIONS.find((item) => item.kind === kind);
  if (!definition) throw new Error(`Unsupported SDLC baseline kind ${kind}`);
  return definition;
}

export function baselineDraftSections(metadata: Metadata): Record<string, BaselineDraftSection> {
  const raw = metadata.draftSections;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, BaselineDraftSection> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const section = value as Record<string, unknown>;
    if (typeof section.title !== 'string' || typeof section.markdown !== 'string') continue;
    result[key] = {
      title: section.title,
      markdown: stripRendererOwnedHeadings(section.markdown, section.title),
      sourceReferences: Array.isArray(section.sourceReferences)
        ? section.sourceReferences.filter(
            (reference): reference is BaselineSourceReference =>
              Boolean(reference) &&
              typeof reference === 'object' &&
              typeof (reference as BaselineSourceReference).path === 'string' &&
              typeof (reference as BaselineSourceReference).commitSha === 'string'
          )
        : [],
    };
  }
  return result;
}

export function applyBaselineDraftSection(
  metadata: Metadata,
  section: {
    sectionKey: string;
    sectionTitle: string;
    markdown: string;
    sourceReferences?: BaselineSourceReference[];
  }
): Metadata {
  const sections = baselineDraftSections(metadata);
  return {
    ...metadata,
    generationStatus: 'GENERATING',
    draftSections: {
      ...sections,
      [section.sectionKey]: {
        title: section.sectionTitle,
        markdown: stripRendererOwnedHeadings(section.markdown, section.sectionTitle),
        sourceReferences: section.sourceReferences ?? [],
      },
    },
  };
}

export function baselineDraftMissingSections(kind: SdlcBaselineKind, metadata: Metadata): string[] {
  const sections = baselineDraftSections(metadata);
  return definitionFor(kind)
    .sections.map((section) => section.key)
    .filter((key) => !sections[key]?.markdown.trim());
}

export function buildBaselineDraftMarkdown(
  title: string,
  kind: SdlcBaselineKind,
  metadata: Metadata,
  finalized = false
): string {
  const definition = definitionFor(kind);
  const sections = baselineDraftSections(metadata);
  const body = definition.sections.map((section) => {
    const content = sections[section.key]?.markdown.trim();
    return `## ${section.title}\n\n${content || '_Pending repository inspection._'}`;
  });
  return [
    `# ${title}`,
    ...(finalized ? [] : ['', '> SDLC baseline generation is in progress.']),
    '',
    ...body,
  ].join('\n');
}

/**
 * Validates that every required section exists, then returns the deduplicated
 * source references collected across sections. The caller resets the canvas
 * metadata to {} and stores the references on the sdlc_artifacts row.
 */
export function finalizeBaselineDraft(
  kind: SdlcBaselineKind,
  metadata: Metadata
): BaselineSourceReference[] {
  const missing = baselineDraftMissingSections(kind, metadata);
  if (missing.length > 0) {
    throw new Error(`Cannot finalize ${kind}; missing sections: ${missing.join(', ')}`);
  }
  const sourceReferences = Object.values(baselineDraftSections(metadata)).flatMap(
    section => section.sourceReferences
  );
  return [
    ...new Map(
      sourceReferences.map(reference => [
        JSON.stringify([
          reference.commitSha,
          reference.path,
          reference.symbol,
          reference.startLine,
          reference.endLine,
        ]),
        reference,
      ])
    ).values(),
  ];
}

export function baselineRefreshChanged(
  currentMarkdown: string,
  candidateMarkdown: string
): boolean {
  const normalize = (value: string) => value.replace(/\r\n/g, '\n').trim();
  return normalize(currentMarkdown) !== normalize(candidateMarkdown);
}
