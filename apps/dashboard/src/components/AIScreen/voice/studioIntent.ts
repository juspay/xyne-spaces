import { commandsForSurface, type CommandDef } from '@xyne/shared/commands';

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'dashboard', re: /\b(dashboard|analytics|kpis?|charts?|graphs?|metrics)\b/i },
  {
    name: 'design',
    re: /\b(design|mockup|wireframe|landing page|redesign|poster|flyer|brochure|banner|figma|ui screen)\b/i,
  },
  { name: 'explainer', re: /\b(explainer|narrated video|walkthrough video)\b/i },
  { name: 'spec', re: /\b(spec|specification|prd|product requirements)\b/i },
  {
    name: 'review',
    re: /\breview\b[^.?!]{0,40}\b(code|changes?|diff|pr|branch|working tree|commits?|implementation)\b|\bcode review\b|\b(walk me through|explain)\b[^.?!]{0,40}\b(code|changes?|diff|pr|branch)\b/i,
  },
  {
    name: 'learn',
    re: /\b(teach me|explain (this|these) (link|links|page|pages|articles?)|help me (learn|understand)|walk me through (this|these) (link|links|articles?)|read (this|these) (link|links|pages?) and)\b/i,
  },
];

export function detectStudioIntent(text: string): CommandDef | null {
  const trimmed = text.trim();
  if (trimmed.length < 8 || trimmed.startsWith('/')) return null;
  const available = new Map(commandsForSurface('ai-screen').map(c => [c.name, c] as const));
  for (const { name, re } of PATTERNS) {
    const command = available.get(name);
    if (command && re.test(trimmed)) return command;
  }
  return null;
}
