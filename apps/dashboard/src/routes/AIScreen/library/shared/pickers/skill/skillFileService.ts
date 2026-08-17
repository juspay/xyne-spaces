import { clawApiRequest } from '@/services/claw/clawRequest';

export interface SkillFileContent {
  readonly id: string;
  readonly relativePath: string;
  readonly content: string;
  readonly contentType: string | null;
  readonly sizeBytes: number;
}

export function getSkillFile(slug: string, fileId: string): Promise<SkillFileContent> {
  return clawApiRequest<SkillFileContent>(
    `/skills/${encodeURIComponent(slug)}/files/${encodeURIComponent(fileId)}`,
  );
}
