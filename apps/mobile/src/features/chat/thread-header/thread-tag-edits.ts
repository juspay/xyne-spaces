/** Apply this sheet's explicit edits to the latest synced tag names. */
export function applyThreadTagEdits(
  applied: readonly string[],
  edits: Readonly<Record<string, boolean>>,
): string[] {
  const selected = new Set(applied);
  for (const [name, included] of Object.entries(edits)) {
    if (included) selected.add(name);
    else selected.delete(name);
  }
  return [...selected];
}
