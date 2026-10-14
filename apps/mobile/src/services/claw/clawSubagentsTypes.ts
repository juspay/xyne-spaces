export type SubagentSource = 'builtin' | 'custom';

export type SubagentShareEntry = {
  readonly userId: string;
  readonly role: 'EDITOR';
  readonly name: string;
  readonly email: string;
};

export type SubagentSkillRef = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
};

export type SubagentTools = {
  direct?: string[];
  custom?: string[];
};

export type SubagentDef = {
  readonly source: SubagentSource;
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly paramName: string;
  readonly paramDescription: string;
  readonly serverType?: string;
  readonly tools?: SubagentTools;
  readonly enabled: boolean;
  readonly skills: SubagentSkillRef[];
  readonly shares?: SubagentShareEntry[];
};
