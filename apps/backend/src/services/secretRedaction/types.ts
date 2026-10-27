export interface AllowlistSpec {
  regexes?: string[];
  /** What `regexes` test against. gitleaks default is the extracted secret. */
  regexTarget?: 'match' | 'line';
  stopwords?: string[];
}

export interface SecretRuleSpec {
  id: string;
  regex: string;
  keywords: string[];
  entropy?: number;
  secretGroup?: number;
  allowlists?: AllowlistSpec[];
}

export interface SecretFinding {
  ruleId: string;
  /** Offsets of the secret (not the whole match) in the scanned text. */
  start: number;
  end: number;
}

export interface RedactionResult {
  text: string;
  findings: SecretFinding[];
}
