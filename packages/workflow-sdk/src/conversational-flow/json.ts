/** Reading unknown JSON without pretending it is typed. Nothing here knows what a flow is. */

export type Rec = Record<string, unknown>;

export interface Step {
  id: string;
  type: string;
  title?: string;
  description?: string;
  settings?: Rec;
  config: Rec;
}

export function asRec(value: unknown): Rec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asSteps(value: unknown): Step[] {
  return asArray(value).filter(
    (s): s is Step => !!s && typeof s === 'object' && typeof (s as Rec)['id'] === 'string' && typeof (s as Rec)['type'] === 'string',
  );
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
