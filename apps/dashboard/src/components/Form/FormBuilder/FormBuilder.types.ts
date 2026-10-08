import type { ReactNode } from 'react';
import type {
  BuilderField,
  BuilderFieldOption,
  FormBuilderData,
  FormBuilderRequestContext,
} from '../../../utils/form/formBuilderTypes';

export type { BuilderField, BuilderFieldOption, FormBuilderData, FormBuilderRequestContext };

export interface FormPersistenceAdapter {
  create(data: FormBuilderData, ctx: FormBuilderRequestContext): Promise<{ formId: string }>;
  update(formId: string, data: FormBuilderData, ctx: FormBuilderRequestContext): Promise<void>;
}

export interface FormBuilderProps {
  mode: 'create' | 'edit';
  /** Required in edit mode when using `persistence`. */
  formId?: string | undefined;
  /**
   * Seed produced by utils/form/formBuilderMapper. A new object reseeds the builder only
   * while the user has made no edits, so a live source (Zero) can fill in after mount.
   */
  initialData?: FormBuilderData | undefined;
  /** Enables the global-field autocomplete on field names. */
  projectId?: string | undefined;
  /** Own-the-write mode. Mutually exclusive with onSubmit. */
  persistence?: FormPersistenceAdapter | undefined;
  /** Delegate mode — the host performs the write. Mutually exclusive with persistence. */
  onSubmit?: ((data: FormBuilderData) => void | Promise<void>) | undefined;
  /** Fired after a successful adapter save (create gets the new formId). */
  onSaved?: ((formId: string) => void) | undefined;
  /** Required with `persistence` (hosts own the context/entity/project pickers). */
  requestContext?: FormBuilderRequestContext | undefined;
  submitLabel?: string | undefined;
  /** Renders the static view (no inputs, no footer). The host owns the Edit affordance. */
  readOnly?: boolean | undefined;
  /** Hard read-only + banner (ACL lock). Implies read-only. */
  locked?: boolean | undefined;
  lockedReason?: string | undefined;
  /** Allow editing formName (default true). Set false if a Zero adapter is ever wired. */
  allowRename?: boolean | undefined;
  /** Host-driven pending state (disables inputs + save). */
  disabled?: boolean | undefined;
  /** Host fields rendered above the form title, inside the scroll area. */
  headerSlot?: ReactNode;
  /** Host controls rendered just above the field list (e.g. the project for new fields). */
  fieldsSlot?: ReactNode;
  /** Renders a Cancel button next to the submit button. */
  onCancel?: (() => void) | undefined;
  /** data-track-category passthrough ('Forms' | 'board_config' | ...). */
  trackingCategory?: string | undefined;
  className?: string | undefined;
  contentClassName?: string | undefined;
  footerClassName?: string | undefined;
}
