export type CanvasMentionDisplayProps = {
  groupId?: unknown;
  groupName?: unknown;
  username?: unknown;
};

const getStringProp = (value: unknown): string => (typeof value === 'string' ? value : '');

export const getCanvasMentionDisplayText = (
  props: CanvasMentionDisplayProps | null | undefined,
): string => {
  const groupId = getStringProp(props?.groupId);
  const groupName = getStringProp(props?.groupName);
  const username = getStringProp(props?.username);

  return groupId && groupName ? groupName : username;
};
