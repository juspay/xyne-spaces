import type { ReactElement } from 'react';
import {
  Paperclip,
  AppWindow,
  FileCode2,
  FileText,
  GitCompare,
  Globe,
  Link2,
  Monitor,
  Palette,
  SquarePen,
  ClipboardCheck,
  GraduationCap,
} from 'lucide-react';
import type { ConversationArtifactKind } from '../../../services/XyneAI/XyneAIArtifactsService';

export function artifactKindIcon(kind: ConversationArtifactKind, className: string): ReactElement {
  switch (kind) {
    case 'CANVAS':
      return <SquarePen className={className} aria-hidden='true' />;
    case 'REACT_APP':
      return <AppWindow className={className} aria-hidden='true' />;
    case 'DESIGN_HTML':
      return <Palette className={className} aria-hidden='true' />;
    case 'FILE':
      return <FileText className={className} aria-hidden='true' />;
    case 'DIFF':
      return <GitCompare className={className} aria-hidden='true' />;
    case 'PREVIEW':
      return <Monitor className={className} aria-hidden='true' />;
    case 'SPEC':
      return <FileCode2 className={className} aria-hidden='true' />;
    case 'LINK':
      return <Link2 className={className} aria-hidden='true' />;
    case 'PAGE':
      return <Globe className={className} aria-hidden='true' />;
    case 'REVIEW_ROOM':
      return <ClipboardCheck className={className} aria-hidden='true' />;
    case 'LESSON':
      return <GraduationCap className={className} aria-hidden='true' />;
    case 'UPLOAD':
      return <Paperclip className={className} aria-hidden='true' />;
  }
}

export function artifactKindLabel(kind: ConversationArtifactKind): string {
  switch (kind) {
    case 'CANVAS':
      return 'Canvas';
    case 'REACT_APP':
      return 'App';
    case 'DESIGN_HTML':
      return 'Design';
    case 'FILE':
      return 'File';
    case 'DIFF':
      return 'Diff';
    case 'PREVIEW':
      return 'Preview';
    case 'SPEC':
      return 'Spec';
    case 'LINK':
      return 'Link';
    case 'PAGE':
      return 'Page';
    case 'REVIEW_ROOM':
      return 'Review room';
    case 'LESSON':
      return 'Lesson';
    case 'UPLOAD':
      return 'Attachment';
  }
}

const PROVIDER_LABELS: Record<string, string> = {
  google_docs: 'Google Docs',
  google_sheets: 'Google Sheets',
  google_slides: 'Google Slides',
  pitch: 'Pitch',
  figma: 'Figma',
  notion: 'Notion',
  github: 'GitHub',
  jira: 'Jira',
  other: 'Link',
};

export function providerLabel(provider: string | null | undefined): string {
  if (!provider) return 'Link';
  return PROVIDER_LABELS[provider] ?? provider;
}

export function linkHost(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
