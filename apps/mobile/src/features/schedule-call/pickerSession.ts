// Hands a value and an update callback from the form screen to a picker screen pushed over it.
//
// Pickers are separate routes (normal push/back transitions), so they cannot take props. A
// provider would re-render every consumer on any form change; a plain module slot costs nothing.
// Only one picker is ever open at a time, and the next openPickerSession replaces the last one.
export interface PickerSession<TValue, TChange = TValue> {
  /** What the form currently holds; the picker starts from this. */
  value: TValue;
  onChange: (next: TChange) => void;
}

let active: PickerSession<unknown, unknown> | null = null;

export const openPickerSession = <TValue, TChange = TValue>(
  session: PickerSession<TValue, TChange>,
): void => {
  active = session as unknown as PickerSession<unknown, unknown>;
};

export const getPickerSession = <TValue, TChange = TValue>(): PickerSession<
  TValue,
  TChange
> | null => active as unknown as PickerSession<TValue, TChange> | null;

export const closePickerSession = (): void => {
  active = null;
};
