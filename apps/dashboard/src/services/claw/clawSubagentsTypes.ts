export type SubagentSource = 'builtin' | 'custom';

export interface SubagentShareEntry {
  readonly userId: string;
  readonly role: 'EDITOR';
  readonly name: string;
  readonly email: string;
  readonly sharedBy?: string | null;
  readonly createdAt?: string;
}

export interface SubagentSkillRef {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface SubagentTools {
  direct?: string[];
  custom?: string[];
}

export interface SubagentDef {
  readonly source: SubagentSource;
  readonly id?: string;
  readonly name: string;
  readonly description: string;
  readonly progressLabels: string[];
  readonly systemPrompt: string;
  readonly paramName: string;
  readonly paramDescription: string;
  readonly serverType?: string;
  readonly tools?: SubagentTools;
  readonly mcpInstanceMap?: Record<string, string>;
  readonly enabled: boolean;
  readonly createdByUserId?: string | null;
  readonly createdByName?: string | null;
  readonly createdByEmail?: string | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly skills: SubagentSkillRef[];
  readonly shares?: SubagentShareEntry[];
}

export interface SubagentInputBody {
  name: string;
  description: string;
  progressLabels: string[];
  systemPrompt: string;
  paramName?: string;
  paramDescription: string;
  tools: SubagentTools;
  skillIds?: string[];
  mcpInstanceMap?: Record<string, string>;
}

export interface SubagentPermissions {
  readonly isBuiltIn: boolean;
  readonly isOwner: boolean;
  readonly isEditor: boolean;
  readonly canEdit: boolean;
  readonly canShare: boolean;
  readonly canDelete: boolean;
}

export const getSubagentPermissions = (
  subagent: SubagentDef,
  userId: string | undefined,
  isAdmin: boolean,
): SubagentPermissions => {
  const isBuiltIn = subagent.source === 'builtin';
  const isOwner = Boolean(userId && subagent.createdByUserId === userId);
  const isEditor = Boolean(
    userId && subagent.shares?.some(share => share.userId === userId && share.role === 'EDITOR'),
  );
  const canEdit = !isBuiltIn && (isOwner || isEditor || isAdmin);

  return {
    isBuiltIn,
    isOwner,
    isEditor,
    canEdit,
    canShare: canEdit,
    canDelete: canEdit,
  };
};
