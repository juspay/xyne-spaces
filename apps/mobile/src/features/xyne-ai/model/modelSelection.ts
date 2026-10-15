import type { XyneAIModel } from '../api/xyneAICatalog';
import type { ThinkingLevel } from '../api/xyneAIRequest';

export const THINKING_OPTIONS: { value: ThinkingLevel | undefined; label: string }[] = [
  { value: undefined, label: 'Auto' },
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const AUTO_MODEL_DESCRIPTION = 'Balanced quality and speed recommended for most tasks';

/** Model ids end in a release stamp (`-20250514`) that only adds noise in a pill. */
export const formatModelLabel = (id: string): string => id.replace(/-\d{8}$/, '');

export const modelLabel = ({ id, name }: XyneAIModel): string => name ?? formatModelLabel(id);

export const modelPillLabel = (selected: XyneAIModel | undefined): string =>
  selected ? modelLabel(selected) : 'Auto';

export const modelSummary = (selected: XyneAIModel | undefined): string =>
  selected
    ? (selected.description ?? `Every message in this chat runs on ${modelLabel(selected)}`)
    : AUTO_MODEL_DESCRIPTION;

export const autoModelDescription = (defaultModelName: string | undefined): string =>
  defaultModelName ? `Uses ${defaultModelName} by default` : AUTO_MODEL_DESCRIPTION;

export function filterModels(models: XyneAIModel[], query: string): XyneAIModel[] {
  const needle = query.trim().toLowerCase();
  return models.filter(
    model =>
      model.id.toLowerCase().includes(needle) || modelLabel(model).toLowerCase().includes(needle),
  );
}
