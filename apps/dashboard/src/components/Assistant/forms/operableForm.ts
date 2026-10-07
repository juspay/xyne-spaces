import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { FieldValue } from '../actions/action';
import { createStore } from '../../../utils/createStore';
import type { PageId } from '../pages';

// The forms the assistant can operate, and the page each one lives on.
export const FORMS = {
  agent_create: { page: 'ai_agent_create' },
  channel_create: { page: 'add_channel' },
  invite: { page: 'admin_invitations' },
  workspace_general: { page: 'admin_general' },
  role_create: { page: 'admin_role_create' },
  user_group_create: { page: 'admin_user_group_create' },
  workspace_create: { page: 'admin_organisations' },
  organisation_create: { page: 'admin_organisation_create' },
} as const satisfies Record<string, { page: PageId }>;

export type FormId = keyof typeof FORMS;

export interface OperableField {
  get(): FieldValue;
  set(value: FieldValue): void;
  validate?(): string | null; // a message when the value would be refused
  checking?(): boolean; // a check of the value is still running (e.g. availability)
}

export interface OperableForm {
  id: FormId;
  fields: Record<string, OperableField>;
  actions?: Record<string, () => Promise<void> | void>;
  busy?(): boolean; // a submit is already under way
  // Rejects when the page refuses, so a page that only toasts its errors must rethrow them.
  submit(): Promise<void>;
}

const mounted = new Map<FormId, { current: OperableForm | null }>();
const { subscribe, notify } = createStore();
let filling: { form: FormId; field: string } | null = null;

const get = (id: FormId): OperableForm | undefined => mounted.get(id)?.current ?? undefined;

export const operableForms = {
  get,
  subscribe,
  setFilling(target: { form: FormId; field: string } | null): void {
    filling = target;
    notify();
  },
  waitFor(id: FormId, ms: number): Promise<OperableForm> {
    return new Promise((resolve, reject) => {
      const found = get(id);
      if (found) return resolve(found);
      const stop = subscribe(() => {
        const form = get(id);
        if (!form) return;
        clearTimeout(timer);
        stop();
        resolve(form);
      });
      const timer = setTimeout(() => {
        stop();
        reject(new Error(`${id} did not open`));
      }, ms);
    });
  },
};

/** Lets the assistant operate this form while it is mounted; it always sees the latest render. */
export function useOperableForm(form: OperableForm | null): void {
  const ref = useRef(form);
  ref.current = form;
  const id = form?.id;
  useEffect(() => {
    if (!id) return undefined;
    mounted.set(id, ref);
    notify();
    return (): void => {
      if (mounted.get(id) === ref) mounted.delete(id);
    };
  }, [id]);
}

/** True while the assistant is filling this field, for a highlight. */
export function useFilling(form: FormId, field: string): boolean {
  return useSyncExternalStore(subscribe, () => filling?.form === form && filling.field === field);
}
