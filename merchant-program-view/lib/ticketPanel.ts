/**
 * Pure logic behind the Desk-style ticket panel: which stages a ticket can move to, the request a
 * move or a field save becomes, how custom-field values resolve (same rules as the dashboard's
 * resolveBoardAdditionalFields), and ETA state. The component calls the Spaces SDK with these.
 */

export interface PanelStage {
  id: string;
  name: string;
  sequenceNumber: number;
  eta: number | null;
  defaultTicketStatusV2: string;
  requestApprovalOnEntry: boolean | null;
}

export interface PanelTransition {
  fromStageId?: string | null;
  toStageId: string;
  formId?: string | null;
  requiresApproval?: boolean | null;
}

export interface StageOption {
  id: string;
  name: string;
  /** "2/7" — position on the board. */
  label: string;
  current: boolean;
  /** A move target: not the current stage, and reachable from it on non-linear boards. */
  allowed: boolean;
  /** Moves that need a stage form or an approval, which the app sends to Xyne. */
  gate: 'form' | 'approval' | null;
  status: string;
}

const bySeq = <T extends { sequenceNumber: number }>(a: T, b: T): number => a.sequenceNumber - b.sequenceNumber;

export function stageOptions(current: string, stages: PanelStage[], transitions: PanelTransition[], nonLinear: boolean): StageOption[] {
  const sorted = [...stages].sort(bySeq);
  const cur = sorted.find(s => s.name === current);
  return sorted.map((s, i) => {
    // An edge with no fromStageId applies from any stage.
    const edges = transitions.filter(t => t.toStageId === s.id && (!t.fromStageId || t.fromStageId === cur?.id));
    const into = nonLinear ? edges : transitions.filter(t => t.toStageId === s.id);
    const gate = into.some(t => t.formId) ? 'form' : s.requestApprovalOnEntry || into.some(t => t.requiresApproval) ? 'approval' : null;
    return {
      id: s.id,
      name: s.name,
      label: `${i + 1}/${sorted.length}`,
      current: s.name === current,
      allowed: s.name !== current && (!nonLinear || edges.length > 0),
      gate,
      status: s.defaultTicketStatusV2,
    };
  });
}

export type StageMove = { kind: 'update'; data: { stageName: string; statusV2: string } } | { kind: 'transition'; toStageName: string };

/** Linear boards set the stage and its default status; non-linear boards go through a transition. */
export function stageMove(target: Pick<PanelStage, 'name' | 'defaultTicketStatusV2'>, nonLinear: boolean): StageMove {
  return nonLinear ? { kind: 'transition', toStageName: target.name } : { kind: 'update', data: { stageName: target.name, statusV2: target.defaultTicketStatusV2 } };
}

/* ---------- custom fields ---------- */

/** Stored values come as a string, a JSON array string, an array, or a scalar. */
export function parseValues(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try {
        const arr: unknown = JSON.parse(s);
        if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
      } catch {
        // Not JSON: fall through to the raw string.
      }
    }
    return [s];
  }
  return [String(v)];
}

/** Options come as `[{id, value}]` or `["a", "b"]`, possibly JSON-encoded. */
export function parseOptions(v: unknown): string[] {
  let arr: unknown = v;
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map(o => (o && typeof o === 'object' ? String((o as { value?: unknown }).value ?? '') : String(o))).filter(Boolean);
}

interface FieldDef {
  fieldName?: string | null;
  fieldType?: string | null;
  fieldOptions?: unknown;
  fieldEnum?: unknown;
}
interface MembershipRow extends FieldDef {
  id: string;
  globalFieldId?: string | null;
  globalField?: FieldDef | null;
  sequenceNumber?: number | null;
  isOptional?: boolean | null;
}
export interface FieldMapping {
  formId: string;
  formFields?: MembershipRow[];
}
export interface FieldValueRow {
  id: string;
  formId: string;
  fieldId: string;
  contextId: string | null;
  fieldValue?: string | null;
  actualFieldValue?: unknown;
  updatedAt?: number | null;
}

export interface FieldRow {
  /** Global field id when the field is shared, else the board field's own id. */
  fieldId: string;
  name: string;
  type: string;
  options: string[];
  values: string[];
  /** The board-context value row to update; null means saving creates one. */
  rowId: string | null;
  formId: string;
}

const valueOf = (v: FieldValueRow): string[] => parseValues(v.actualFieldValue ?? v.fieldValue);

function latest(rows: FieldValueRow[]): Map<string, FieldValueRow> {
  const m = new Map<string, FieldValueRow>();
  for (const v of rows) {
    const cur = m.get(v.fieldId);
    if (!cur || (v.updatedAt ?? 0) > (cur.updatedAt ?? 0)) m.set(v.fieldId, v);
  }
  return m;
}

/**
 * The board's custom fields with their values: a value saved on the board form wins; otherwise the
 * latest value from any form (a stage form, say) is shown as a prefill, and saving writes it to the
 * board form.
 */
export function resolveFields(mapping: FieldMapping | null | undefined, values: FieldValueRow[], boardId: string): FieldRow[] {
  if (!mapping?.formFields?.length) return [];
  const defs = [...mapping.formFields]
    .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
    .flatMap(row => {
      const g = row.globalFieldId && row.globalField ? row.globalField : null;
      const def = g ?? row;
      if (!def.fieldName || !def.fieldType) return [];
      return [{ fieldId: g ? row.globalFieldId! : row.id, name: def.fieldName, type: def.fieldType, options: parseOptions(def.fieldOptions ?? def.fieldEnum) }];
    });
  const ids = new Set(defs.map(d => d.fieldId));
  const onBoard = latest(values.filter(v => v.formId === mapping.formId && ids.has(v.fieldId) && (!v.contextId || v.contextId === boardId)));
  const anywhere = latest(values.filter(v => ids.has(v.fieldId)));
  return defs.map(d => {
    const own = onBoard.get(d.fieldId);
    const pre = anywhere.get(d.fieldId);
    return { ...d, values: own ? valueOf(own) : pre ? valueOf(pre) : [], rowId: own?.id ?? null, formId: mapping.formId };
  });
}

export type FieldSave =
  | { kind: 'update'; id: string; newValue: string[] }
  | { kind: 'create'; data: { entityId: string; entityType: 'TICKET'; formId: string; fieldId: string; newValue: string[]; contextId: string } };

/** The server wants `string[]` for every field type. */
export function fieldSave(row: FieldRow, newValue: string[], ticketId: string, boardId: string): FieldSave {
  if (row.rowId) return { kind: 'update', id: row.rowId, newValue };
  return { kind: 'create', data: { entityId: ticketId, entityType: 'TICKET', formId: row.formId, fieldId: row.fieldId, newValue, contextId: boardId } };
}

/* ---------- ETAs ---------- */

export interface StageEtaEntry {
  id: string;
  stageId: string;
  stageLeftAt: number | null;
  stageEta: number | null;
}

export interface StageEta {
  /** The current stage has an ETA configured, so the chip shows. */
  show: boolean;
  entryId: string | null;
  stageId: string | null;
  eta: number | null;
  breached: boolean;
}

export function stageEtaState(current: string, stages: PanelStage[], entries: StageEtaEntry[], now: number): StageEta {
  const stage = stages.find(s => s.name === current);
  if (!stage || !stage.eta) return { show: false, entryId: null, stageId: stage?.id ?? null, eta: null, breached: false };
  const entry = entries.find(e => e.stageId === stage.id && e.stageLeftAt === null) ?? null;
  const eta = entry?.stageEta ?? null;
  return { show: true, entryId: entry?.id ?? null, stageId: stage.id, eta, breached: eta !== null && eta < now };
}

export function etaState(eta: number | null, open: boolean, now: number): { eta: number | null; breached: boolean } {
  return { eta, breached: open && eta !== null && eta < now };
}

/** Web pictures load directly; uploaded ones sit behind a dashboard-only endpoint, so use initials. */
export function avatarUrl(picture: string | null | undefined): string | null {
  return picture && /^https?:\/\//.test(picture) ? picture : null;
}

/* ---------- people ---------- */

export interface Person {
  id: string;
  name: string;
  picture: string | null;
  /** Still in the workspace; people who left show on old tickets but aren't offered in pickers. */
  active?: boolean;
}

export interface People {
  list: Person[];
  byId: Map<string, Person>;
  byName: Map<string, Person>;
}

export function indexPeople(list: Person[]): People {
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return { list: sorted, byId: new Map(sorted.map(p => [p.id, p])), byName: new Map(sorted.map(p => [p.name, p])) };
}
