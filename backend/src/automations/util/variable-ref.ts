export {
  VARIABLE_REF_REGEX,
  VARIABLE_REF_DESCRIPTION_PREFIX,
  tokenize,
  isPureRef,
  extractRefPath,
  collectRefs,
} from '@xyne/shared/automations/variable-ref';

export type { VariableRefToken as Token, FoundRef } from '@xyne/shared/automations/variable-ref';
