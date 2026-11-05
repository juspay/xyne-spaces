import { z } from 'zod';

export enum ValidationIssueCode {
  SHAPE = 'shape',
  UNKNOWN_REFERENCE = 'unknownReference',
  FORWARD_REFERENCE = 'forwardReference',
  TYPE_MISMATCH = 'typeMismatch',
  ACCESS_DENIED = 'accessDenied',
}

export interface AccessContext {
  userId: string;
  workspaceId: string;
  role?: string;
}

export const ValidationIssueCodeSchema = z.nativeEnum(ValidationIssueCode);

export interface ValidationIssue {
  path: string;
  code: ValidationIssueCode;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}
