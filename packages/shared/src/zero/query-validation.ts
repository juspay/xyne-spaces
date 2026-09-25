type Condition =
  | { type: 'simple'; left: { name: string }; op: string; right: unknown }
  | { type: 'and'; conditions: readonly Condition[] }
  | { type: 'or'; conditions: readonly Condition[] }
  | { type: 'correlatedSubquery'; [key: string]: unknown };

interface QueryAST {
  table?: string;
  where?: Condition;
}

/**
 * Which workspaces a table's fields are encrypted at rest for:
 * `'all'` = every workspace, `string[]` = only rows owned by those workspaces (`[]` = never).
 * `null` is accepted for wire compatibility and means the same as `[]`.
 * Encryption-side only: decryption is driven by the `ENC:` prefix on the value,
 * so narrowing the scope leaves already-encrypted rows readable.
 */
export type EncryptedWorkspaceScope = 'all' | string[] | null;

/** Per-table encrypted-fields config, as served by the backend's /encryption/public-key. */
export interface EncryptedTableConfig {
  fields: string[];
  enforceClientEncryption: boolean;
  workspaceIds: EncryptedWorkspaceScope;
}

/** True when the scope encrypts nothing: `null` or an empty workspace list. */
export function isEncryptionScopeEmpty(scope: EncryptedWorkspaceScope): boolean {
  return scope === null || (Array.isArray(scope) && scope.length === 0);
}

/** Whether a row owned by `workspaceId` falls inside the table's encryption scope. */
export function isWorkspaceInEncryptionScope(scope: EncryptedWorkspaceScope, workspaceId: string): boolean {
  if (scope === null) return false;
  if (scope === 'all') return true;
  return scope.includes(workspaceId);
}

export class EncryptedFieldQueryError extends Error {
  public readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'EncryptedFieldQueryError';
  }
}

/**
 * Rejects Zero queries that filter on an encrypted column: ciphertext is opaque,
 * so such a WHERE clause can never match. `encryptedFields` is the runtime
 * config the caller already holds.
 */
export function validateQueryWhereClause(
  query: unknown,
  encryptedFields: Record<string, EncryptedTableConfig>,
): void {
  const queryWithAst = query as { ast?: QueryAST };

  if (!queryWithAst.ast) {
    return;
  }

  const table = queryWithAst.ast.table;
  const where = queryWithAst.ast.where;

  if (!table) {
    return;
  }

  const tableConfig = encryptedFields[table];

  if (!tableConfig || tableConfig.fields.length === 0) {
    return;
  }

  const fields = tableConfig.fields;

  function walkCondition(condition: Condition): void {
    if (!condition || typeof condition !== 'object') {
      return;
    }

    switch (condition.type) {
      case 'simple': {
        const fieldName = condition.left?.name;
        if (fieldName && fields.includes(fieldName)) {
          throw new EncryptedFieldQueryError(
            `Zero query on table "${table}" uses encrypted field "${fieldName}" in WHERE clause. Encrypted fields cannot be used for filtering.`
          );
        }
        break;
      }
      case 'and':
      case 'or': {
        if (Array.isArray(condition.conditions)) {
          for (const subCondition of condition.conditions) {
            walkCondition(subCondition);
          }
        }
        break;
      }
      case 'correlatedSubquery':
        break;
      default:
        break;
    }
  }

  if (where) {
    walkCondition(where);
  }
}
