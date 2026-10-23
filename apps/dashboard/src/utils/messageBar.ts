import { MESSAGE_BAR_ACTION_IDS, type MessageBarActionId } from '../constants/messageBar';

const ACTION_IDS = new Set<string>(MESSAGE_BAR_ACTION_IDS);

export const isMessageBarActionId = (id: string): id is MessageBarActionId => ACTION_IDS.has(id);
