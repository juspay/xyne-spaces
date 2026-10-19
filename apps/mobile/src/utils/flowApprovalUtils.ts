import { listFlowActionButtons, type FlowActionButton } from '@/src/utils/flowAction';
import type {
  FlowComponentLike,
  FlowDefinitionLike,
  FlowTextNormalizationOptions,
} from '@/src/utils/flowJsonMarkdown';

export type WriteApprovalViewModel = {
  title: string;
  intro: string;
  actionName: string;
  actionBodyMarkdown: string;
  tool?: string;
  buttons: FlowActionButton[];
};

const DEFAULT_TITLE = 'Action Approval';
const DEFAULT_INTRO = 'The agent wants to execute:';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getStringProp = (props: Record<string, unknown> | undefined, key: string): string => {
  const value = props?.[key];
  return typeof value === 'string' ? value.trim() : '';
};

const getComponentType = (component: FlowComponentLike): string =>
  typeof component.type === 'string' ? component.type : '';

const getRawTextContent = (component: FlowComponentLike | undefined): string => {
  if (!component || getComponentType(component) !== 'text') return '';
  const props = isRecord(component.props) ? component.props : undefined;
  return getStringProp(props, 'content');
};

const extractActionName = (content: string): string => {
  const firstLine = content.trim().split('\n')[0] ?? '';
  const emphasized = /^\*([^*]+)\*$/.exec(firstLine.trim());
  if (emphasized?.[1]) return emphasized[1].trim();
  return firstLine.replace(/^\*+|\*+$/g, '').trim();
};

const findFirstTopLevelCardBody = (components: FlowComponentLike[] | undefined): string => {
  if (!components) return '';
  for (const component of components) {
    if (getComponentType(component) !== 'card' || !Array.isArray(component.children)) continue;
    for (const child of component.children) {
      const content = getRawTextContent(child);
      if (content) return content;
    }
  }
  return '';
};

const findIntroText = (components: FlowComponentLike[] | undefined): string => {
  if (!components) return '';
  for (const component of components) {
    if (getComponentType(component) !== 'text') continue;
    const content = getRawTextContent(component);
    if (content) return content;
  }
  return '';
};

export const isWriteApprovalFlow = (flow: FlowDefinitionLike): boolean => {
  const actionType = flow.data?.['actionType'];
  if (actionType === 'write') return true;

  const screenId = typeof flow.screenId === 'string' ? flow.screenId.trim() : '';
  return screenId.startsWith('write-approval');
};

export const createWriteApprovalViewModel = (
  flow: FlowDefinitionLike,
  normalizeText: (text: string) => string,
): WriteApprovalViewModel | null => {
  if (!isWriteApprovalFlow(flow)) return null;

  const rawIntro = findIntroText(flow.components) || DEFAULT_INTRO;
  const rawActionBody = findFirstTopLevelCardBody(flow.components);
  if (!rawActionBody) return null;

  const title =
    typeof flow.title === 'string' && flow.title.trim() ? flow.title.trim() : DEFAULT_TITLE;
  const toolValue = flow.data?.['tool'];
  const tool = typeof toolValue === 'string' && toolValue.trim() ? toolValue.trim() : undefined;

  return {
    title,
    intro: normalizeText(rawIntro),
    actionName: extractActionName(rawActionBody),
    actionBodyMarkdown: normalizeText(rawActionBody),
    ...(tool ? { tool } : {}),
    buttons: listFlowActionButtons(flow),
  };
};

export const writeApprovalFlowToMarkdown = (
  flow: FlowDefinitionLike,
  normalizeText: (text: string) => string,
  options: FlowTextNormalizationOptions = {},
): string => {
  const viewModel = createWriteApprovalViewModel(flow, normalizeText);
  if (!viewModel) return '';

  const lines = [`# ${viewModel.title}`, viewModel.intro, viewModel.actionBodyMarkdown];

  if (!options.omitButtons) {
    for (const button of viewModel.buttons) {
      lines.push(`**${normalizeText(button.label)}**`);
    }
  }

  return lines.filter(line => line.trim().length > 0).join('\n\n');
};
